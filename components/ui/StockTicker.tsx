'use client';

import { useState, useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, Minus, RefreshCw, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface IndexData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
}

interface TickerResponse {
  success: boolean;
  data: IndexData[];
  isMock: boolean;
  lastUpdated: string;
}

function formatPrice(price: number | undefined | null): string {
  if (price === undefined || price === null) return '-';

  if (price >= 10000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  } else if (price >= 100) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
}

function formatChange(change: number | undefined | null, percent: number | undefined | null): string {
  if (change === undefined || change === null || percent === undefined || percent === null) {
    return '- (-%)';
  }

  const sign = change >= 0 ? '+' : '';
  if (Math.abs(change) >= 100) {
    return `${sign}${change.toFixed(0)} (${sign}${percent.toFixed(2)}%)`;
  }
  return `${sign}${change.toFixed(2)} (${sign}${percent.toFixed(2)}%)`;
}

function TickerItem({ data, isCompact }: { data: IndexData; isCompact?: boolean }) {
  const isPositive = data.change > 0;
  const isNegative = data.change < 0;
  const isNeutral = data.change === 0;

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-4 py-1 whitespace-nowrap',
        isCompact ? 'gap-1.5 px-3' : 'gap-2 px-4'
      )}
    >
      {/* Index name */}
      <span className="font-medium text-foreground text-sm">
        {data.name}
      </span>

      {/* Price */}
      <span className="text-foreground-secondary text-sm">
        {formatPrice(data.price)}
      </span>

      {/* Change indicator */}
      <div
        className={cn(
          'flex items-center gap-1 text-xs font-medium',
          isPositive && 'text-green-500',
          isNegative && 'text-red-500',
          isNeutral && 'text-foreground-secondary'
        )}
      >
        {isPositive && <TrendingUp className="w-3 h-3" />}
        {isNegative && <TrendingDown className="w-3 h-3" />}
        {isNeutral && <Minus className="w-3 h-3" />}
        <span>{formatChange(data.change, data.changePercent)}</span>
      </div>
    </div>
  );
}

export function StockTicker() {
  const [tickerData, setTickerData] = useState<IndexData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const scrollPositionRef = useRef(0);

  const fetchData = async () => {
    try {
      const response = await fetch('/api/stocks');
      const data: TickerResponse = await response.json();

      if (data.success && data.data.length > 0) {
        setTickerData(data.data);
        setIsMock(data.isMock);
        setLastUpdated(data.lastUpdated);
        setError(null);
      } else {
        throw new Error('No data received');
      }
    } catch (err) {
      console.error('Failed to fetch ticker data:', err);
      setError('Failed to load market data');
    } finally {
      setIsLoading(false);
    }
  };

  // Initial fetch and refresh interval
  useEffect(() => {
    const initialFetch = window.setTimeout(fetchData, 0);

    // Refresh every 60 seconds
    const interval = setInterval(fetchData, 60000);

    return () => {
      window.clearTimeout(initialFetch);
      clearInterval(interval);
    };
  }, []);

  // Smooth scrolling animation
  useEffect(() => {
    if (!scrollRef.current || tickerData.length === 0) return;

    const scrollContainer = scrollRef.current;
    const scrollWidth = scrollContainer.scrollWidth / 2; // Half because we duplicate content
    const speed = 0.5; // Pixels per frame

    const animate = () => {
      if (!isPaused) {
        scrollPositionRef.current += speed;

        // Reset when we've scrolled through the first set
        if (scrollPositionRef.current >= scrollWidth) {
          scrollPositionRef.current = 0;
        }

        scrollContainer.scrollLeft = scrollPositionRef.current;
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [tickerData, isPaused]);

  if (isLoading) {
    return (
      <div className="h-8 bg-background-tertiary border-b border-border flex items-center justify-center">
        <RefreshCw className="w-4 h-4 animate-spin text-foreground-secondary" />
        <span className="ml-2 text-xs text-foreground-secondary">Loading market data...</span>
      </div>
    );
  }

  if (error && tickerData.length === 0) {
    return (
      <div className="h-8 bg-background-tertiary border-b border-border flex items-center justify-center">
        <AlertCircle className="w-4 h-4 text-error" />
        <span className="ml-2 text-xs text-error">{error}</span>
        <button
          onClick={fetchData}
          className="ml-3 text-xs text-accent hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      className="h-8 bg-background-tertiary border-b border-border flex items-center overflow-hidden relative"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Live indicator */}
      <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center px-3 bg-gradient-to-r from-background-tertiary via-background-tertiary to-transparent">
        <div className="flex items-center gap-1.5">
          <div className={cn(
            'w-2 h-2 rounded-full',
            isMock ? 'bg-yellow-500' : 'bg-green-500 animate-pulse'
          )} />
          <span className="text-xs font-medium text-foreground-secondary">
            {isMock ? 'DEMO' : 'LIVE'}
          </span>
        </div>
      </div>

      {/* Scrolling ticker */}
      <div
        ref={scrollRef}
        className="flex items-center overflow-hidden ml-16"
        style={{ scrollBehavior: 'auto' }}
      >
        {/* Duplicate content for seamless loop */}
        <div className="flex items-center">
          {tickerData.map((item, index) => (
            <div key={`${item.symbol}-1-${index}`} className="flex items-center">
              <TickerItem data={item} isCompact />
              <span className="text-foreground-secondary/30 mx-1">|</span>
            </div>
          ))}
        </div>
        <div className="flex items-center">
          {tickerData.map((item, index) => (
            <div key={`${item.symbol}-2-${index}`} className="flex items-center">
              <TickerItem data={item} isCompact />
              <span className="text-foreground-secondary/30 mx-1">|</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right fade */}
      <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-background-tertiary to-transparent pointer-events-none" />

      {/* Last updated tooltip on hover */}
      {isPaused && lastUpdated && (
        <div className="absolute right-3 top-0 bottom-0 flex items-center z-10">
          <span className="text-xs text-foreground-secondary bg-background-tertiary px-2">
            Updated: {new Date(lastUpdated).toLocaleTimeString()}
          </span>
        </div>
      )}
    </div>
  );
}
