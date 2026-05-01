'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw, X, Loader2, AlertCircle, GripVertical, GripHorizontal } from 'lucide-react';
import { CheckCheck } from 'lucide-react';
import { useReadArticlesStore } from '@/lib/read-articles-store';
import { ColumnSettingsMenu } from './ColumnSettingsMenu';
import { Column as ColumnType, Article, FeedItem } from '@/lib/types';
import { useDeckStore, DEFAULT_COLUMN_WIDTH, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH } from '@/lib/store';
import { useArticlesStore } from '@/lib/articles-store';
import { useSettingsStore, ArticleAgeFilter } from '@/lib/settings-store';
import { deleteColumnRequest, updateColumnRequest } from '@/lib/deck-client';
import { ArticleCard } from './ArticleCard';
import { AdCard } from './AdCard';
import { injectAds } from '@/lib/injectAds';
import { cn } from '@/lib/utils';
import { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';

// Normalize title for comparison (remove punctuation, lowercase, trim)
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Filter articles by age
function filterArticlesByAge(articles: Article[], filter: ArticleAgeFilter): Article[] {
  if (filter === 'all') return articles;

  const now = new Date();
  let cutoffDate: Date;

  switch (filter) {
    case '1day':
      cutoffDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case '3days':
      cutoffDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      break;
    case '7days':
      cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    default:
      return articles;
  }

  return articles.filter((article) => {
    const articleDate = new Date(article.pubDate);
    return articleDate >= cutoffDate;
  });
}

// Deduplicate articles by URL and similar titles
function deduplicateArticles(articles: Article[]): Article[] {
  const seen = new Map<string, Article>();
  const seenTitles = new Map<string, Article>();

  for (const article of articles) {
    // Check by URL first (most reliable)
    const url = article.link?.toLowerCase().trim();
    if (url && seen.has(url)) {
      continue; // Skip duplicate URL
    }

    // Check by normalized title
    const normalizedTitle = normalizeTitle(article.title || '');
    if (normalizedTitle && seenTitles.has(normalizedTitle)) {
      continue; // Skip duplicate title
    }

    // Not a duplicate, add it
    if (url) seen.set(url, article);
    if (normalizedTitle) seenTitles.set(normalizedTitle, article);
  }

  // Return articles in original order, filtered
  return articles.filter((article) => {
    const url = article.link?.toLowerCase().trim();
    const normalizedTitle = normalizeTitle(article.title || '');
    return (url && seen.get(url) === article) ||
      (!url && normalizedTitle && seenTitles.get(normalizedTitle) === article);
  });
}

interface ColumnProps {
  column: ColumnType;
  onArticleClick: (article: Article) => void;
  selectedArticleId: string | null;
  refreshTrigger: number;
  dragHandleProps?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
}

export function Column({ column, onArticleClick, selectedArticleId, refreshTrigger, dragHandleProps, dragListeners }: ColumnProps) {
  const cachedArticles = useArticlesStore((state) => state.articlesByColumn.get(column.id));
  const initialCachedArticles = useRef(cachedArticles);
  const [articles, setArticles] = useState<Article[]>(cachedArticles ?? []);
  const [isLoading, setIsLoading] = useState(column.sources.length > 0 && !cachedArticles?.length);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const setColumns = useDeckStore((state) => state.setColumns);
  const setSavedFeeds = useDeckStore((state) => state.setSavedFeeds);
  const setColumnWidth = useDeckStore((state) => state.setColumnWidth);
  const setColumnArticles = useArticlesStore((state) => state.setColumnArticles);
  const articleAgeFilter = useSettingsStore((state) => state.articleAgeFilter);
  const { isRead, markAllRead } = useReadArticlesStore();
  const keywordAlerts = useSettingsStore((state) => state.keywordAlerts);
  const unreadCount = articles.filter((a) => !isRead(a.id)).length;

  const columnRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const resizedWidthRef = useRef(column.width || DEFAULT_COLUMN_WIDTH);
  const prevArticleIdsRef = useRef<Set<string> | null>(null);

  // Use fallback width if column.width is undefined
  const columnWidth = column.width || DEFAULT_COLUMN_WIDTH;
  const handleNewArticles = useCallback((next: Article[]) => {
    const prev = prevArticleIdsRef.current;

    if (prev !== null && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const newArticles = next.filter((a) => !prev.has(a.id));
      const enabledAlerts = keywordAlerts.filter((a) => a.enabled);

      for (const article of newArticles) {
        const matchedAlert = enabledAlerts.find((a) => {
          const escaped = a.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return new RegExp(`\\b${escaped}\\b`, 'i').test(article.title);
        });
        if (matchedAlert && document.visibilityState === 'hidden') {
          new Notification(`🔔 ${matchedAlert.keyword}`, {
            body: article.title,
            icon: '/icon.png',
          });
        }
      }
    }

    prevArticleIdsRef.current = new Set(next.map((a) => a.id));
    setArticles(next);
    setColumnArticles(column.id, next);
  }, [column.id, keywordAlerts, setColumnArticles]);

  const applyDeckState = useCallback((deckState: { columns: ColumnType[]; savedFeeds: { id: string; url: string; title: string }[] }) => {
    setColumns(deckState.columns);
    setSavedFeeds(deckState.savedFeeds);
  }, [setColumns, setSavedFeeds]);

  const fetchFeeds = useCallback(async () => {
    // Handle 'list' and 'search' column types via the articles endpoint
    if (column.type === 'list' || column.type === 'search') {
      try {
        const res = await fetch(`/api/deck/columns/${column.id}/articles`);
        if (!res.ok) throw new Error('Failed to fetch articles');
        const data = await res.json();

        // Sort by date, newest first
        const sortedArticles = (data as Article[]).sort(
          (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
        );

        // Remove duplicates (by URL and title)
        const uniqueArticles = deduplicateArticles(sortedArticles);

        handleNewArticles(uniqueArticles);
        setError(null);
      } catch (err) {
        setError('Failed to load articles');
        console.error(err);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
      return;
    }

    // Legacy column types (single-feed, category, unified)
    if (column.sources.length === 0) {
      setArticles([]);
      setIsLoading(false);
      return;
    }

    try {
      const allArticles: Article[] = [];

      await Promise.all(
        column.sources.map(async (source) => {
          try {
            const res = await fetch(`/api/rss?url=${encodeURIComponent(source.url)}`);
            if (!res.ok) throw new Error(`Failed to fetch ${source.title}`);
            const data = await res.json();
            if (data.items) {
              allArticles.push(...data.items);
            }
          } catch (err) {
            console.error(`Error fetching ${source.url}:`, err);
          }
        })
      );

      // Sort by date, newest first
      allArticles.sort(
        (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
      );

      // Remove duplicates (by URL and title)
      const uniqueArticles = deduplicateArticles(allArticles);

      handleNewArticles(uniqueArticles);
      setError(null);
    } catch (err) {
      setError('Failed to load feeds');
      console.error(err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [column.type, column.id, column.sources, handleNewArticles]);

  // Initial load / manual refresh trigger
  useEffect(() => {
    if (initialCachedArticles.current && initialCachedArticles.current.length > 0 && refreshTrigger === 0) {
      setArticles(initialCachedArticles.current);
      setIsLoading(false);
    } else {
      void fetchFeeds();
    }
  }, [fetchFeeds, refreshTrigger]);

  // Auto-refresh interval — runs independently so it isn't reset by fetch results
  useEffect(() => {
    const intervalMs = column.settings.refreshInterval * 60 * 1000;
    const interval = setInterval(fetchFeeds, intervalMs);
    return () => clearInterval(interval);
  }, [fetchFeeds, column.settings.refreshInterval]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchFeeds();
  };

  // Resize handlers
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = columnWidth;

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  };

  const handleResizeMove = useCallback((e: MouseEvent) => {
    const diff = e.clientX - startXRef.current;
    const newWidth = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, startWidthRef.current + diff));
    resizedWidthRef.current = newWidth;
    setColumnWidth(column.id, newWidth);
  }, [column.id, setColumnWidth]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
    void updateColumnRequest(column.id, { width: resizedWidthRef.current })
      .then(applyDeckState)
      .catch((resizeError) => {
        console.error('Failed to persist column width:', resizeError);
      });
  }, [applyDeckState, column.id, handleResizeMove]);

  const handleRemoveColumn = async () => {
    try {
      applyDeckState(await deleteColumnRequest(column.id));
    } catch (removeError) {
      console.error('Failed to remove column:', removeError);
    }
  };

  return (
    <div
      ref={columnRef}
      className="h-full flex flex-col bg-background-secondary border-r border-border relative"
      style={{
        width: `${columnWidth}px`,
        minWidth: `${MIN_COLUMN_WIDTH}px`,
        maxWidth: `${MAX_COLUMN_WIDTH}px`,
        flexShrink: 0,
        flexGrow: 0,
      }}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-background-tertiary flex-shrink-0 group/header relative z-20">
        <div className="flex items-center min-w-0 flex-1">
          <div
            {...dragHandleProps}
            {...dragListeners}
            className="cursor-grab active:cursor-grabbing p-2 -ml-2 mr-1 text-foreground-secondary/50 hover:text-foreground hover:bg-background-secondary rounded opacity-0 group-hover/header:opacity-100 transition-opacity touch-none flex-shrink-0"
          >
            <GripHorizontal className="w-5 h-5" />
          </div>
          <h2 className="font-bold text-sm truncate">{column.title}</h2>
          <span className="text-xs text-foreground-secondary ml-2 whitespace-nowrap">
            {column.type === 'list' ? 'List' : column.type === 'search' ? 'Search' : `${column.sources.length} ${column.sources.length === 1 ? 'feed' : 'feeds'}`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <>
              <span className="text-[10px] font-bold bg-accent text-white px-1.5 py-0.5 rounded-full leading-none">
                {unreadCount}
              </span>
              <button
                onClick={() => markAllRead(articles.map((a) => a.id))}
                className="p-1.5 hover:bg-background-secondary rounded transition-colors text-foreground-secondary hover:text-accent"
                title="Mark all as read"
              >
                <CheckCheck className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1.5 hover:bg-background-secondary rounded transition-colors text-foreground-secondary hover:text-foreground"
            title="Refresh"
          >
            <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
          </button>
          <ColumnSettingsMenu column={column} />
          <button
            onClick={() => void handleRemoveColumn()}
            className="p-1.5 hover:bg-background-secondary rounded transition-colors text-foreground-secondary hover:text-error"
            title="Remove column"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Column Content */}
      <div className="flex-1 overflow-y-auto column-scroll">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-32 text-error px-4">
            <AlertCircle className="w-6 h-6 mb-2" />
            <p className="text-sm text-center">{error}</p>
            <button
              onClick={handleRefresh}
              className="mt-2 text-xs text-accent hover:underline"
            >
              Try again
            </button>
          </div>
        ) : articles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-foreground-secondary px-4">
            <p className="text-sm text-center">No articles found</p>
            {column.sources.length === 0 && column.type !== 'list' && column.type !== 'search' && (
              <p className="text-xs mt-1">Add some feeds to this column</p>
            )}
            {(column.type === 'list' || column.type === 'search') && articles.length === 0 && (
              <p className="text-xs mt-1">No articles yet</p>
            )}
          </div>
        ) : (
          (() => {
            const filteredArticles = filterArticlesByAge(articles, articleAgeFilter);
            if (filteredArticles.length === 0) {
              return (
                <div className="flex flex-col items-center justify-center h-32 text-foreground-secondary px-4">
                  <p className="text-sm text-center">No articles in this time range</p>
                  <p className="text-xs mt-1">Try a longer time range filter</p>
                </div>
              );
            }
            const feedItems: FeedItem[] = injectAds(filteredArticles);
            return feedItems.map((item) => {
              if ('type' in item && item.type === 'ad') {
                return <AdCard key={item.id} />;
              }
              const article = item as Article;
              return (
                <ArticleCard
                  key={article.id}
                  article={article}
                  viewMode={column.settings.viewMode}
                  onClick={onArticleClick}
                  isSelected={article.id === selectedArticleId}
                />
              );
            });
          })()
        )}
      </div>

      {/* Resize Handle */}
      <div
        onMouseDown={handleResizeStart}
        className={cn(
          'absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-accent/50 transition-colors group',
          isResizing && 'bg-accent'
        )}
      >
        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-8 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical className="w-3 h-3 text-foreground-secondary" />
        </div>
      </div>
    </div>
  );
}
