'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Rss, LayoutDashboard, Newspaper, Search, Bookmark, Moon, Sun, List } from 'lucide-react';
import { IntelliDeckMark } from '@/components/ui/IntelliDeckMark';
import { cn } from '@/lib/utils';
import { useBookmarksStore } from '@/lib/bookmarks-store';
import { useSettingsStore } from '@/lib/settings-store';
import { useTranslation } from '@/lib/i18n';

interface TopNavBarProps {
  pageActions?: React.ReactNode;
}

const NAV_ITEMS = [
  { href: '/', labelKey: 'nav.rss', icon: Rss },
  { href: '/intelligence', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/briefings', labelKey: 'nav.briefings', icon: Newspaper },
  { href: '/search', labelKey: 'nav.search', icon: Search },
  { href: '/lists', labelKey: 'nav.lists', icon: List },
];

export function TopNavBar({ pageActions }: TopNavBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const bookmarkCount = useBookmarksStore((state) => state.bookmarks.length);
  const { themeId, setTheme } = useSettingsStore();
  const { t, locale } = useTranslation();
  const setLocale = useSettingsStore((state) => state.setLocale);

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    router.prefetch('/');
    router.prefetch('/intelligence');
    router.prefetch('/briefings');
    router.prefetch('/search');
    router.prefetch('/bookmarks');
    router.prefetch('/lists');
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
          <IntelliDeckMark size={30} className="group-hover:opacity-90 transition-opacity flex-shrink-0" />
          <span className="font-extrabold text-lg tracking-tight" style={{ letterSpacing: '-0.02em' }}>
            <span style={{ color: isDarkMode ? '#ffffff' : '#001426' }}>Intelli</span>
            <span style={{ color: '#FF6A00' }}>Deck</span>
          </span>
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
              title={t(item.labelKey)}
              className={navItemClass(active)}
              onMouseEnter={() => prefetchRoute(item.href)}
              onFocus={() => prefetchRoute(item.href)}
            >
              <div className="relative">
                <Icon className={cn("w-5 h-5", active && "mb-[1px]")} strokeWidth={active ? 2.5 : 2} />
              </div>
              <span className={cn("text-[10px] uppercase font-semibold tracking-wider", active ? "text-accent" : "hidden md:block")}>
                {t(item.labelKey)}
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
          href="/bookmarks"
          prefetch
          title={t('nav.bookmarks')}
          className={cn(
            'relative w-9 h-9 flex items-center justify-center rounded-full transition-colors',
            pathname === '/bookmarks'
              ? 'bg-accent/10 text-accent'
              : 'text-foreground-secondary hover:bg-background-tertiary hover:text-foreground'
          )}
          onMouseEnter={() => prefetchRoute('/bookmarks')}
          onFocus={() => prefetchRoute('/bookmarks')}
        >
          <Bookmark className="w-4 h-4" />
          {bookmarkCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] bg-warning text-background text-[10px] font-bold rounded-full flex items-center justify-center px-1">
              {bookmarkCount > 99 ? '99+' : bookmarkCount}
            </span>
          )}
        </Link>

        <button
          onClick={() => setLocale(locale === 'en' ? 'zh-CN' : 'en')}
          title={t('nav.switchLanguage')}
          className="w-9 h-9 flex items-center justify-center rounded-full text-foreground-secondary hover:bg-background-tertiary hover:text-foreground transition-colors font-semibold text-xs"
        >
          {locale === 'en' ? 'EN' : '中'}
        </button>

        <button
          onClick={toggleTheme}
          title={isDarkMode ? t('nav.switchToLight') : t('nav.switchToDark')}
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
