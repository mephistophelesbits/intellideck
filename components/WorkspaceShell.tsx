'use client';

import { TopNavBar } from '@/components/ui/TopNavBar';

type WorkspaceShellProps = {
  title: string;
  description: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
};

export function WorkspaceShell({ title, description, actions, children }: WorkspaceShellProps) {
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <TopNavBar />
      <main className="min-w-0 flex-1 overflow-auto">

        <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
          <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="hidden md:flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-foreground-secondary mb-3">
                <span>RSS Deck</span>
                <span>/</span>
                <span className="text-foreground">{title}</span>
              </div>
              <h1 className="text-3xl font-semibold">{title}</h1>
              <p className="mt-1 text-sm text-foreground-secondary">{description}</p>
            </div>
            {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
          </header>

          <div className="space-y-6 md:space-y-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
