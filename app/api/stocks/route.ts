import { NextResponse } from 'next/server';

interface IndexData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
}

// Major world indices with their Yahoo Finance symbols
const INDICES = [
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^DJI', name: 'DOW' },
  { symbol: '^IXIC', name: 'NASDAQ' },
  { symbol: '^RUT', name: 'Russell 2K' },
  { symbol: '^VIX', name: 'VIX' },
  { symbol: '^FTSE', name: 'FTSE 100' },
  { symbol: '^GDAXI', name: 'DAX' },
  { symbol: '^FCHI', name: 'CAC 40' },
  { symbol: '^N225', name: 'Nikkei' },
  { symbol: '^HSI', name: 'Hang Seng' },
  { symbol: '000001.SS', name: 'Shanghai' },
  { symbol: '^STOXX50E', name: 'Euro Stoxx' },
  { symbol: '^GSPTSE', name: 'TSX' },
  { symbol: '^AXJO', name: 'ASX 200' },
  { symbol: 'GC=F', name: 'Gold' },
  { symbol: 'CL=F', name: 'Crude Oil' },
  { symbol: 'BTC-USD', name: 'Bitcoin' },
  { symbol: 'EURUSD=X', name: 'EUR/USD' },
];

async function fetchYahooFinanceData(symbols: string[]): Promise<IndexData[]> {
  // Fetch all symbols in parallel
  const promises = symbols.map(async (symbol) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        next: { revalidate: 60 }, // Cache for 60 seconds
      });

      if (!response.ok) {
        console.error(`Failed to fetch ${symbol}: ${response.status}`);
        return null;
      }

      const data = await response.json();
      const result = data.chart?.result?.[0];

      if (!result) return null;

      const meta = result.meta;
      const quote = result.indicators?.quote?.[0];

      if (!meta || !quote) return null;

      const currentPrice = meta.regularMarketPrice || meta.previousClose || 0;
      const previousClose = meta.chartPreviousClose || meta.previousClose || currentPrice || 1; // Avoid division by zero
      const change = currentPrice - previousClose;
      const changePercent = previousClose !== 0 ? (change / previousClose) * 100 : 0;

      const indexInfo = INDICES.find((i) => i.symbol === symbol);

      return {
        symbol,
        name: indexInfo?.name || meta.shortName || symbol,
        price: currentPrice,
        change,
        changePercent,
        previousClose,
      };
    } catch (error) {
      console.error(`Error fetching ${symbol}:`, error);
      return null;
    }
  });

  const allResults = await Promise.all(promises);
  return allResults.filter((r): r is IndexData => r !== null);
}

// Fallback mock data when API fails
function getMockData(): IndexData[] {
  return INDICES.slice(0, 12).map((index) => {
    const basePrice = Math.random() * 10000 + 1000;
    const changePercent = (Math.random() - 0.5) * 4;
    const change = (basePrice * changePercent) / 100;

    return {
      symbol: index.symbol,
      name: index.name,
      price: basePrice,
      change,
      changePercent,
      previousClose: basePrice - change,
    };
  });
}

export async function GET() {
  try {
    const symbols = INDICES.map((i) => i.symbol);
    const data = await fetchYahooFinanceData(symbols);

    if (data.length === 0) {
      // Return mock data if all fetches fail
      return NextResponse.json({
        success: true,
        data: getMockData(),
        isMock: true,
        lastUpdated: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      success: true,
      data,
      isMock: false,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Stock API error:', error);

    return NextResponse.json({
      success: true,
      data: getMockData(),
      isMock: true,
      lastUpdated: new Date().toISOString(),
    });
  }
}
