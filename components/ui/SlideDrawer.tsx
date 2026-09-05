'use client';

import type { ReactNode } from 'react';

interface SlideDrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Drawer width in px (capped at 92vw). */
  width?: number;
  children: ReactNode;
}

/** Right-side slide-in drawer: backdrop + header bar + a flex-col body the caller fills. */
export function SlideDrawer({ open, title, onClose, width = 420, children }: SlideDrawerProps) {
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden />}
      <aside
        className={`fixed right-0 top-0 z-50 h-full max-w-[92vw] border-l border-border bg-card shadow-xl
          transition-transform duration-200 flex flex-col ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ width }}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-border p-3">
          <span className="text-sm font-medium text-foreground">{title}</span>
          <button type="button" onClick={onClose} className="text-foreground opacity-60 hover:opacity-100">✕</button>
        </div>
        {children}
      </aside>
    </>
  );
}
