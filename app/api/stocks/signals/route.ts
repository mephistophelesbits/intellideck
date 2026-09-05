import { NextRequest, NextResponse } from 'next/server';

// Stock watchlist - can be moved to settings later
const WATCHLIST = ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'TSLA', 'META', 'AMZN'];

async function fetchStockPrice(symbol: string): Promise<any> {
  try {
    // Using Yahoo Finance API (free, no key needed)
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=60d`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const result = data.chart?.result?.[0];

    if (!result) return null;

    const meta = result.meta;
    const timestamps = result.timestamp || [];
    const quotes = result.indicators.quote[0];
    const close = quotes.close || [];

    // Get last 50 days for analysis
    const prices = close.slice(-50).filter((p: any) => p !== null);

    return {
      symbol,
      currentPrice: meta.regularMarketPrice,
      previousClose: meta.regularMarketPreviousClose,
      open: meta.regularMarketOpen,
      high: meta.regularMarketDayHigh,
      low: meta.regularMarketDayLow,
      volume: meta.regularMarketVolume,
      timestamps,
      prices
    };
  } catch (error) {
    console.error(`Error fetching ${symbol}:`, error);
    return null;
  }
}

// Calculate Simple Moving Average
function calculateSMA(prices: number[], period: number): number {
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

// Calculate RSI
function calculateRSI(prices: number[], period: number = 14): number {
  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  const gains = changes.slice(-period).filter(c => c > 0);
  const losses = changes.slice(-period).filter(c => c < 0).map(c => Math.abs(c));

  const avgGain = gains.reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// Calculate MACD
function calculateMACD(prices: number[]) {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macdLine = ema12 - ema26;
  const signalLine = calculateEMA([macdLine], 9);
  const histogram = macdLine - signalLine;

  return { macdLine, signalLine, histogram };
}

// Calculate EMA
function calculateEMA(prices: number[], period: number): number {
  const k = 2 / (period + 1);
  let ema = prices[0];

  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }

  return ema;
}

// Find support and resistance levels
function findSupportResistance(prices: number[]): { support: number; resistance: number } {
  const recentPrices = prices.slice(-20);
  const min = Math.min(...recentPrices);
  const max = Math.max(...recentPrices);

  return {
    support: min,
    resistance: max
  };
}

// Generate trading signal
function analyzeStock(data: any): any {
  if (!data || data.prices.length < 50) {
    return null;
  }

  const prices = data.prices;
  const currentPrice = data.currentPrice;

  // Calculate indicators
  const sma20 = calculateSMA(prices, 20);
  const sma50 = calculateSMA(prices, 50);
  const rsi = calculateRSI(prices);
  const { macdLine, signalLine } = calculateMACD(prices);
  const { support, resistance } = findSupportResistance(prices);

  // Count indicators agreeing
  let bullishSignals = 0;
  let bearishSignals = 0;
  const signals: string[] = [];

  // Trend (SMA)
  if (currentPrice > sma50) {
    bullishSignals++;
    signals.push('Above SMA50 🟢');
  } else {
    bearishSignals++;
    signals.push('Below SMA50 🔴');
  }

  if (currentPrice > sma20) {
    bullishSignals++;
    signals.push('Above SMA20 🟢');
  } else {
    bearishSignals++;
    signals.push('Below SMA20 🔴');
  }

  // RSI
  if (rsi !== undefined && rsi !== null) {
    if (rsi < 35) {
      bullishSignals++;
      signals.push(`RSI Oversold (${rsi.toFixed(1)}) 🟢`);
    } else if (rsi > 65) {
      bearishSignals++;
      signals.push(`RSI Overbought (${rsi.toFixed(1)}) 🔴`);
    } else {
      signals.push(`RSI Neutral (${rsi.toFixed(1)})`);
    }
  } else {
    signals.push('RSI Data Unavailable');
  }

  // MACD
  if (macdLine > signalLine) {
    bullishSignals++;
    signals.push('MACD Bullish 🟢');
  } else {
    bearishSignals++;
    signals.push('MACD Bearish 🔴');
  }

  // Determine confidence and recommendation
  const totalSignals = bullishSignals + bearishSignals;
  const confidence = totalSignals >= 3 ?
    (bullishSignals >= 3 ? 'HIGH' : bearishSignals >= 3 ? 'HIGH' : 'MEDIUM') :
    'LOW';

  // Calculate entry, stop, target
  let entry = currentPrice;
  let stop: number | null = null;
  let target: number | null = null;
  let recommendation: string = 'HOLD';

  if (bullishSignals >= 2) {
    recommendation = 'BUY';
    entry = currentPrice;
    stop = support * 0.95; // 5% below support
    target = resistance * 0.98; // Just below resistance
  } else if (bearishSignals >= 2) {
    recommendation = 'SELL';
    entry = currentPrice;
    stop = resistance * 1.05; // 5% above resistance
    target = support * 1.02; // Just above support
  }

  const riskReward = stop && target ?
    Math.abs((target - entry) / (entry - stop)) : 0;

  return {
    symbol: data.symbol,
    currentPrice,
    sma20,
    sma50,
    rsi,
    support,
    resistance,
    signals,
    recommendation,
    entry: (entry ?? 0).toFixed(2),
    stop: stop?.toFixed(2) ?? '-',
    target: target?.toFixed(2) ?? '-',
    riskReward: (riskReward ?? 0).toFixed(1),
    confidence
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbols = searchParams.get('symbols')?.split(',') || WATCHLIST;

    // Fetch all stocks
    const stocks = await Promise.all(
      symbols.map(s => fetchStockPrice(s.toUpperCase()))
    );

    // Analyze each stock
    const signals = stocks
      .map(data => analyzeStock(data))
      .filter(s => s !== null);

    return NextResponse.json({
      signals,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Stock analysis failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { symbols, telegramSettings } = await req.json();

    // Fetch and analyze stocks
    const stocks = await Promise.all(
      (symbols || WATCHLIST).map((s: string) => fetchStockPrice(s.toUpperCase()))
    );

    const signals = stocks
      .map(data => analyzeStock(data))
      .filter(s => s !== null);

    // Format for Telegram
    let telegramMessage = `📊 *DAILY STOCK SIGNALS*\n\n`;

    signals.forEach(s => {
      const emoji = s.recommendation === 'BUY' ? '🟢' : s.recommendation === 'SELL' ? '🔴' : '⚪';

      telegramMessage += `${emoji} *${s.symbol}* \\- $${s.currentPrice}\\n`;
      telegramMessage += `Entry: \\$${s.entry} | Stop: \\$${s.stop} | Target: \\$${s.target}\\n`;
      telegramMessage += `Risk:Reward *1:${s.riskReward}* | Confidence: ${s.confidence}\\n`;
      const rsiStr = s.rsi !== undefined && s.rsi !== null ? s.rsi.toFixed(1) : '-';
      const sma20Str = s.sma20 !== undefined && s.sma20 !== null ? s.sma20.toFixed(2) : '-';
      const sma50Str = s.sma50 !== undefined && s.sma50 !== null ? s.sma50.toFixed(2) : '-';

      telegramMessage += `R\\.S\\.I: ${rsiStr} | SMA20: \\$${sma20Str} | SMA50: \\$${sma50Str}\\n`;
      telegramMessage += `──────────────────\\n`;
    });

    telegramMessage += `_Signals generated at ${new Date().toLocaleTimeString()}_`;

    // Push to Telegram if configured
    let telegramError = null;
    if (telegramSettings?.enabled && telegramSettings.token && telegramSettings.chatId) {
      const telegramUrl = `https://api.telegram.org/bot${telegramSettings.token}/sendMessage`;

      try {
        const res = await fetch(telegramUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramSettings.chatId,
            text: telegramMessage,
            parse_mode: 'MarkdownV2'
          }),
        });

        if (!res.ok) {
          telegramError = await res.text();
        }
      } catch (err: any) {
        telegramError = err.message;
      }
    }

    return NextResponse.json({
      signals,
      telegramMessage,
      telegramError,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Stock signals failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
