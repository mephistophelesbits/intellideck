'use client';

import { useEffect } from 'react';
import { fetchDeckState } from '@/lib/deck-client';
import { useDeckStore } from '@/lib/store';
import { useSettingsStore } from '@/lib/settings-store';
import { useBookmarksStore } from '@/lib/bookmarks-store';
import { useReadArticlesStore } from '@/lib/read-articles-store';
import type { SettingsSnapshot } from '@/lib/settings-store';
import type { Article } from '@/lib/types';

interface StoreHydrationProps {
  children: React.ReactNode;
}

const HYDRATION_TIMEOUT_MS = 4_000;

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutId: number | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out`)), HYDRATION_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}

async function fetchJsonWithTimeout<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), HYDRATION_TIMEOUT_MS);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    return await response.json() as T;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function StoreHydration({ children }: StoreHydrationProps) {
  const setColumns = useDeckStore((state) => state.setColumns);
  const setSavedFeeds = useDeckStore((state) => state.setSavedFeeds);
  const hydrateSettings = useSettingsStore((state) => state.hydrateSettings);
  const hydrateBookmarks = useBookmarksStore((state) => state.hydrateBookmarks);
  const hydrateReadIds = useReadArticlesStore((state) => state.hydrateReadIds);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const [deckStateResult, settingsResult, bookmarksResult, readIdsResult] = await Promise.allSettled([
        withTimeout(fetchDeckState(), 'Deck hydration'),
        fetchJsonWithTimeout<SettingsSnapshot>('/api/settings', { cache: 'no-store' }),
        fetchJsonWithTimeout<Article[]>('/api/bookmarks', { cache: 'no-store' }),
        fetchJsonWithTimeout<{ readIds: string[] }>('/api/articles/read', { cache: 'no-store' }),
      ]);

      if (cancelled) {
        return;
      }

      if (deckStateResult.status === 'fulfilled') {
        setColumns(deckStateResult.value.columns);
        setSavedFeeds(deckStateResult.value.savedFeeds);
      } else {
        console.error('Failed to hydrate deck state:', deckStateResult.reason);
      }

      if (settingsResult.status === 'fulfilled') {
        hydrateSettings(settingsResult.value);
      } else {
        console.error('Failed to hydrate settings:', settingsResult.reason);
      }

      if (bookmarksResult.status === 'fulfilled') {
        hydrateBookmarks(bookmarksResult.value);
      } else {
        console.error('Failed to hydrate bookmarks:', bookmarksResult.reason);
      }

      if (readIdsResult.status === 'fulfilled') {
        hydrateReadIds(readIdsResult.value.readIds);
      } else {
        console.error('Failed to hydrate read articles:', readIdsResult.reason);
      }
    };

    hydrate();

    return () => {
      cancelled = true;
    };
  }, [hydrateBookmarks, hydrateSettings, setColumns, setSavedFeeds, hydrateReadIds]);

  return <>{children}</>;
}
