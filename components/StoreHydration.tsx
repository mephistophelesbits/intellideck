'use client';

import { useEffect, useState } from 'react';
import { fetchDeckState } from '@/lib/deck-client';
import { useDeckStore } from '@/lib/store';
import { useSettingsStore } from '@/lib/settings-store';
import { useBookmarksStore } from '@/lib/bookmarks-store';

interface StoreHydrationProps {
  children: React.ReactNode;
}

export function StoreHydration({ children }: StoreHydrationProps) {
  const [isHydrated, setIsHydrated] = useState(false);
  const setColumns = useDeckStore((state) => state.setColumns);
  const setSavedFeeds = useDeckStore((state) => state.setSavedFeeds);
  const hydrateSettings = useSettingsStore((state) => state.hydrateSettings);
  const hydrateBookmarks = useBookmarksStore((state) => state.hydrateBookmarks);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const [deckState, settingsResponse, bookmarksResponse] = await Promise.all([
          fetchDeckState(),
          fetch('/api/settings', { cache: 'no-store' }),
          fetch('/api/bookmarks', { cache: 'no-store' }),
        ]);

        const settings = await settingsResponse.json();
        const bookmarks = await bookmarksResponse.json();
        if (!cancelled) {
          setColumns(deckState.columns);
          setSavedFeeds(deckState.savedFeeds);
          hydrateSettings(settings);
          hydrateBookmarks(bookmarks);
        }
      } catch (error) {
        console.error('Failed to hydrate deck state:', error);
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    };

    hydrate();

    return () => {
      cancelled = true;
    };
  }, [hydrateBookmarks, hydrateSettings, setColumns, setSavedFeeds]);

  if (!isHydrated) {
    // Show loading state during SSR and initial hydration
    return (
      <div className="flex h-screen bg-background items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-foreground-secondary text-sm">Loading RSS Deck...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
