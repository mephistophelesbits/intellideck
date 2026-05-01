'use client';

import { Coffee } from 'lucide-react';

export function AdCard() {
  const handleClick = () => {
    window.open('https://buymeacoffee.com/kianfongl', '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="border-b border-border px-3 py-3 bg-accent-light/40 hover:bg-accent-light/60 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Coffee className="w-4 h-4 text-accent flex-shrink-0" />
          <p className="text-sm text-foreground">
            Like IntelliDeck?{' '}
            <button
              onClick={handleClick}
              className="text-accent hover:underline font-medium"
            >
              Buy Fong a coffee.
            </button>
          </p>
        </div>
        <span className="text-[10px] text-foreground-secondary flex-shrink-0 mt-0.5">Support</span>
      </div>
    </div>
  );
}
