'use client';

import { Coffee } from 'lucide-react';

const BMAC_URL = 'https://buymeacoffee.com/kianfongl';

export function AdCard() {
  const handleClick = () => {
    // window.open is intercepted by Electron's setWindowOpenHandler in main.ts,
    // which routes external URLs to shell.openExternal — works under sandbox: true.
    window.open(BMAC_URL, '_blank');
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full text-left border-b border-border px-3 py-3 bg-accent-light/40 hover:bg-accent-light/60 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Coffee className="w-4 h-4 text-accent flex-shrink-0" />
          <p className="text-sm text-foreground">
            Like IntelliDeck?{' '}
            <span className="text-accent font-medium underline">Buy Fong a coffee.</span>
          </p>
        </div>
        <span className="text-[10px] text-foreground-secondary flex-shrink-0 mt-0.5">Support</span>
      </div>
    </button>
  );
}
