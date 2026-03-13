'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Rss, BrainCircuit, Newspaper, Bookmark, Search, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBookmarksStore } from '@/lib/bookmarks-store';
import { useSettingsStore } from '@/lib/settings-store';

interface TopNavBarProps {
  pageActions?: React.ReactNode;
}

const NAV_ITEMS = [
  { href: '/', label: 'RSS', icon: Rss },
  { href: '/intelligence', label: 'Intelligence', icon: BrainCircuit },
  { href: '/briefings', label: 'Briefings', icon: Newspaper },
  { href: '/bookmarks', label: 'Bookmarks', icon: Bookmark },
];

export function TopNavBar({ pageActions }: TopNavBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const bookmarkCount = useBookmarksStore((state) => state.bookmarks.length);
  const { themeId, setTheme } = useSettingsStore();

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    setMounted(true);
    router.prefetch('/');
    router.prefetch('/intelligence');
    router.prefetch('/briefings');
    router.prefetch('/bookmarks');
    router.prefetch('/search');
  }, [router]);

  const prefetchRoute = (href: string) => {
    router.prefetch(href);
  };

  const navItemClass = (active: boolean) =>
    cn(
      'relative flex flex-col items-center justify-center gap-1 rounded-lg px-4 py-2 transition-colors',
      active
        ? 'text-accent'
        : 'text-foreground-secondary hover:bg-background-tertiary hover:text-foreground'
    );

  const toggleTheme = () => {
    if (themeId === 'stitch-dark') {
      setTheme('stitch-light');
    } else {
      setTheme('stitch-dark');
    }
  };

  // Only render theme toggle after mounting to avoid hydration mismatch
  const isDarkMode = mounted && themeId === 'stitch-dark';

  return (
    <div className="relative z-30 w-full h-16 bg-background-secondary border-b border-border flex items-center justify-between px-6 flex-shrink-0">
      {/* Left section: Logo */}
      <div className="flex items-center">
        <Link
          href="/"
          onClick={(e) => {
            if (pathname === '/') {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          className="flex items-center gap-2 group"
        >
          <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center group-hover:opacity-90 transition-opacity">
            <Rss className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">RSS Deck</span>
        </Link>
      </div>

      {/* Center section: Navigation */}
      <nav className="flex items-center gap-2 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              title={item.label}
              className={navItemClass(active)}
              onMouseEnter={() => prefetchRoute(item.href)}
              onFocus={() => prefetchRoute(item.href)}
            >
              <div className="relative">
                <Icon className={cn("w-5 h-5", active && "mb-[1px]")} strokeWidth={active ? 2.5 : 2} />
                {item.href === '/bookmarks' && bookmarkCount > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-[16px] h-[16px] bg-warning text-background text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                    {bookmarkCount > 99 ? '99+' : bookmarkCount}
                  </span>
                )}
              </div>
              <span className={cn("text-[10px] uppercase font-semibold tracking-wider", active ? "text-accent" : "hidden md:block")}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Right section: Actions & Search & Theme */}
      <div className="flex items-center gap-3">
        {/* Page specific actions like Add Column, Refresh, Settings */}
        {pageActions && (
          <div className="flex items-center gap-2 pr-4 border-r border-border mr-1">
            {pageActions}
          </div>
        )}

        <Link
          href="/search"
          prefetch
          title="Search"
          className={cn(
            'w-9 h-9 flex items-center justify-center rounded-full transition-colors',
            pathname === '/search'
              ? 'bg-accent/10 text-accent'
              : 'text-foreground-secondary hover:bg-background-tertiary hover:text-foreground'
          )}
          onMouseEnter={() => prefetchRoute('/search')}
          onFocus={() => prefetchRoute('/search')}
        >
          <Search className="w-4 h-4" />
        </Link>
        
        <button
          onClick={toggleTheme}
          title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
          className="w-9 h-9 flex items-center justify-center rounded-full text-foreground-secondary hover:bg-background-tertiary hover:text-foreground transition-colors"
        >
          {mounted ? (
            isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />
          ) : (
            <div className="w-4 h-4 rounded-full bg-border animate-pulse" />
          )}
        </button>
      </div>
    </div>
  );
}
