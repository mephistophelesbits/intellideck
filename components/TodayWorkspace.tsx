'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import {
  Flame,
  Hash,
  Newspaper,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { AppChrome } from '@/components/AppChrome';
import { ArticlePreviewPanel } from '@/components/ui/ArticlePreviewPanel';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { useTranslation } from '@/lib/i18n';
import { useSettingsStore } from '@/lib/settings-store';
import { Article } from '@/lib/types';
import { cn } from '@/lib/utils';

type TodayBriefing = {
  id: string;
  briefingDate: string;
  title: string;
  executiveSummary: string;
  keyThemes: string[];
  topStories: Array<{
    articleId: string;
    title: string;
    url: string;
    sourceTitle: string | null;
    category: string | null;
  }>;
};

type PriorityItem = {
  id: string;
  url: string;
  title: string;
  publishedAt: string | null;
  updatedAt: string;
  sourceTitle: string | null;
  sourceUrl: string;
  author: string | null;
  summary: string | null;
  content: string | null;
  thumbnail: string | null;
  category: string | null;
  tags: string[];
  aiScore?: number;
  curationReason?: string;
  priorityScore: number;
  basePriorityScore?: number;
  preferenceBoost?: number;
  recommendationVariant?: 'baseline' | 'personalized' | 'exploration';
  feedbackValue?: -1 | 0 | 1;
  urgency: 'urgent' | 'important' | 'watch';
  reasons: string[];
};

type TodayPayload = {
  latestBriefing: TodayBriefing | null;
  priorityItems: PriorityItem[];
  curation?: {
    mode: 'ai' | 'deterministic';
    provider?: string;
    model?: string;
    candidateCount?: number;
    selectedCount?: number;
    error: string | null;
    refreshing?: boolean;
    generatedAt?: string;
  };
  topTags: Array<{
    tag: string;
    count: number;
  }>;
  sourceHealth: {
    totalFeeds: number;
    healthyFeeds: number;
    failingFeeds: number;
    neverFetchedFeeds: number;
  };
  lastIngestedAt: string | null;
  topMovers: Array<{
    category: string;
    currentCount: number;
    previousCount: number;
    delta: number;
  }>;
};

const SUMMARY_INTERVAL_MS = 12 * 60 * 60 * 1000;
const SUMMARY_RETRY_BACKOFF_MS = 15 * 60 * 1000;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toArticle(item: PriorityItem): Article {
  return {
    id: item.id,
    title: item.title,
    link: item.url,
    pubDate: item.publishedAt || item.updatedAt,
    contentSnippet: item.summary ?? undefined,
    content: item.content ?? undefined,
    author: item.author ?? undefined,
    thumbnail: item.thumbnail ?? undefined,
    sourceTitle: item.sourceTitle ?? undefined,
    sourceUrl: item.sourceUrl,
  };
}

function isSameArticleSnapshot(a: Article | null, b: Article) {
  if (!a) return false;

  return (
    a.id === b.id &&
    a.title === b.title &&
    a.link === b.link &&
    a.pubDate === b.pubDate &&
    a.contentSnippet === b.contentSnippet &&
    a.content === b.content &&
    a.author === b.author &&
    a.thumbnail === b.thumbnail &&
    a.sourceTitle === b.sourceTitle &&
    a.sourceUrl === b.sourceUrl
  );
}

export function TodayWorkspace() {
  const { t, locale } = useTranslation();
  const aiSettings = useSettingsStore((state) => state.aiSettings);
  const defaultRefreshInterval = useSettingsStore((state) => state.defaultRefreshInterval);
  const [payload, setPayload] = useState<TodayPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [columnWidths, setColumnWidths] = useState({ briefing: 360, feed: 500 });
  const [feedbackPendingIds, setFeedbackPendingIds] = useState<Set<string>>(() => new Set());
  const refreshInFlightRef = useRef(false);
  const summaryInFlightRef = useRef(false);
  const lastSummaryAttemptRef = useRef(0);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const resizeRef = useRef<{
    panel: 'briefing' | 'feed';
    startX: number;
    startBriefing: number;
    startFeed: number;
  } | null>(null);

  const briefingSections = useMemo(
    () =>
      payload?.latestBriefing?.executiveSummary
        .split(/\n\s*\n/)
        .map((section) => section.trim())
        .filter(Boolean) ?? [],
    [payload?.latestBriefing?.executiveSummary]
  );
  const summaryText = useMemo(
    () => briefingSections[0]?.replace(/^[-*#\s]+/, '') ?? '',
    [briefingSections]
  );
  const summaryIsFresh = useMemo(() => {
    if (!payload?.latestBriefing) return false;
    const generatedAt = Date.parse(payload.latestBriefing.briefingDate);
    return Number.isFinite(generatedAt) && Date.now() - generatedAt < SUMMARY_INTERVAL_MS;
  }, [payload?.latestBriefing]);
  const filteredPriorityItems = useMemo(() => {
    if (!selectedTag) return payload?.priorityItems ?? [];
    return (payload?.priorityItems ?? []).filter((item) => item.tags.includes(selectedTag));
  }, [payload?.priorityItems, selectedTag]);

  useEffect(() => {
    if (!selectedTag || !payload) return;
    if (payload.topTags.some((item) => item.tag === selectedTag)) return;
    setSelectedTag(null);
  }, [payload, selectedTag]);

  const loadToday = useCallback(async () => {
    const response = await fetch('/api/today', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to load today');
    }
    setPayload(data);
  }, []);

  useEffect(() => {
    void loadToday()
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Failed to load today.'))
      .finally(() => setIsLoading(false));
  }, [loadToday]);

  useEffect(() => {
    if (filteredPriorityItems.length === 0) {
      if (selectedArticle) setSelectedArticle(null);
      return;
    }

    const visibleSelectedItem = selectedArticle
      ? filteredPriorityItems.find((item) => item.id === selectedArticle.id)
      : null;

    if (!visibleSelectedItem) {
      const nextArticle = toArticle(filteredPriorityItems[0]);
      if (!isSameArticleSnapshot(selectedArticle, nextArticle)) {
        setSelectedArticle(nextArticle);
      }
      return;
    }

    const nextSelectedArticle = toArticle(visibleSelectedItem);
    if (!isSameArticleSnapshot(selectedArticle, nextSelectedArticle)) {
      setSelectedArticle(nextSelectedArticle);
    }
  }, [filteredPriorityItems, selectedArticle]);

  useEffect(() => {
    const handleFeedsRefreshed = () => {
      void loadToday().catch((error) => {
        setMessage(error instanceof Error ? error.message : 'Failed to reload today.');
      });
    };

    window.addEventListener('intellideck:feeds-refreshed', handleFeedsRefreshed);
    return () => window.removeEventListener('intellideck:feeds-refreshed', handleFeedsRefreshed);
  }, [loadToday]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadToday().catch((error) => {
        console.warn('Today polling refresh failed:', error);
      });
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [loadToday]);

  useEffect(() => {
    if (!payload?.curation?.refreshing) return;

    const timeout = window.setTimeout(() => {
      void loadToday().catch((error) => {
        setMessage(error instanceof Error ? error.message : 'Failed to reload today.');
      });
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, [loadToday, payload?.curation?.refreshing, payload?.curation?.generatedAt]);

  const handleRefreshAll = useCallback(async (silent = false) => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;

    try {
      if (!silent) setMessage(null);
      const response = await fetch('/api/intelligence/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to refresh saved feeds');
      }
      await loadToday();
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [loadToday]);

  const selectPriorityByOffset = useCallback((offset: number) => {
    if (filteredPriorityItems.length === 0) return;

    const currentIndex = selectedArticle
      ? filteredPriorityItems.findIndex((item) => item.id === selectedArticle.id)
      : -1;
    const nextIndex = currentIndex === -1
      ? 0
      : clamp(currentIndex + offset, 0, filteredPriorityItems.length - 1);
    const nextItem = filteredPriorityItems[nextIndex];
    if (!nextItem) return;

    setSelectedArticle(toArticle(nextItem));
    window.requestAnimationFrame(() => {
      itemRefs.current.get(nextItem.id)?.scrollIntoView({ block: 'nearest' });
    });
  }, [filteredPriorityItems, selectedArticle]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        selectPriorityByOffset(1);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        selectPriorityByOffset(-1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectPriorityByOffset]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const resize = resizeRef.current;
      if (!resize) return;

      const diff = event.clientX - resize.startX;
      setColumnWidths({
        briefing: resize.panel === 'briefing'
          ? clamp(resize.startBriefing + diff, 280, 560)
          : resize.startBriefing,
        feed: resize.panel === 'feed'
          ? clamp(resize.startFeed + diff, 360, 760)
          : resize.startFeed,
      });
    };

    const handleMouseUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleResizeStart = (panel: 'briefing' | 'feed', event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeRef.current = {
      panel,
      startX: event.clientX,
      startBriefing: columnWidths.briefing,
      startFeed: columnWidths.feed,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleFeedback = useCallback(async (
    item: PriorityItem,
    value: -1 | 1,
    event: ReactMouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const nextValue: -1 | 0 | 1 = item.feedbackValue === value ? 0 : value;
    const previousValue = item.feedbackValue ?? 0;

    setFeedbackPendingIds((current) => new Set(current).add(item.id));
    setPayload((current) => current
      ? {
          ...current,
          priorityItems: current.priorityItems.map((priorityItem) =>
            priorityItem.id === item.id
              ? { ...priorityItem, feedbackValue: nextValue }
              : priorityItem
          ),
        }
      : current);

    try {
      const response = await fetch('/api/today/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId: item.id, value: nextValue }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save feedback');
      }
      await loadToday();
    } catch (error) {
      setPayload((current) => current
        ? {
            ...current,
            priorityItems: current.priorityItems.map((priorityItem) =>
              priorityItem.id === item.id
                ? { ...priorityItem, feedbackValue: previousValue }
                : priorityItem
            ),
          }
        : current);
      setMessage(error instanceof Error ? error.message : 'Failed to save feedback.');
    } finally {
      setFeedbackPendingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }, [loadToday]);

  const handleGenerateSummary = useCallback(async (silent = false, force = true) => {
    if (summaryInFlightRef.current) return;
    summaryInFlightRef.current = true;
    lastSummaryAttemptRef.current = Date.now();
    setIsGenerating(true);
    if (!silent) setMessage(null);
    try {
      const response = await fetch('/api/today/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiSettings,
          locale,
          force,
          priorityItems: payload?.priorityItems ?? [],
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate summary');
      }
      await loadToday();
      if (!silent) setMessage(t('today.summaryGenerated'));
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : 'Failed to generate summary.');
      if (silent) console.warn('Automatic Today summary failed:', error);
    } finally {
      setIsGenerating(false);
      summaryInFlightRef.current = false;
    }
  }, [aiSettings, loadToday, locale, payload?.priorityItems, t]);

  useEffect(() => {
    if (isLoading || payload?.curation?.refreshing || !payload?.priorityItems.length || summaryIsFresh) return;
    if (Date.now() - lastSummaryAttemptRef.current < SUMMARY_RETRY_BACKOFF_MS) return;

    void handleGenerateSummary(true, false);
  }, [
    handleGenerateSummary,
    isLoading,
    payload?.curation?.refreshing,
    payload?.priorityItems.length,
    summaryIsFresh,
  ]);

  return (
    <AppChrome onRefreshAll={handleRefreshAll} showAddFeedAction={false}>
      <div className="h-full overflow-y-auto custom-scrollbar">
        <div className="mx-auto w-full max-w-[1800px] px-4 py-3 md:px-6 md:py-4">
          <header className="mb-3 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-foreground-secondary">
                <Sparkles className="h-4 w-4 text-accent" />
                <span>{t('today.agentDesk')}</span>
              </div>
              <h1 className="text-3xl font-semibold tracking-normal">{t('today.title')}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-lg border border-border bg-background-secondary px-3 py-2 text-xs text-foreground-secondary">
                {t('today.autoRefresh', { minutes: Math.max(1, defaultRefreshInterval || 10) })}
              </div>
              <button
                type="button"
                onClick={() => void handleGenerateSummary(false, true)}
                disabled={isGenerating}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-[color:var(--accent-foreground)] transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {isGenerating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {isGenerating ? t('today.generatingSummary') : t('today.generateSummary')}
              </button>
              <Link
                href="/raw-feed"
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background-secondary px-3 py-2 text-sm font-medium text-foreground-secondary transition-colors hover:border-accent hover:text-foreground"
              >
                <Newspaper className="h-4 w-4" />
                {t('today.rawFeed')}
              </Link>
            </div>
          </header>

          {message && (
            <div className="mb-4 rounded-lg border border-border bg-background-secondary px-4 py-3 text-sm text-foreground-secondary">
              {message}
            </div>
          )}

          {isLoading ? (
            <div className="rounded-xl border border-border bg-background-secondary p-5 text-sm text-foreground-secondary">
              {t('today.loading')}
            </div>
          ) : (
            <div
              className="flex flex-col gap-5 xl:grid xl:gap-0"
              style={{
                gridTemplateColumns: `${columnWidths.briefing}px 12px ${columnWidths.feed}px 12px minmax(720px, 1fr)`,
              }}
            >
              <aside className="space-y-5 xl:sticky xl:top-20 xl:self-start">
                <section className="rounded-xl border border-border bg-background-secondary p-4 md:p-5">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-foreground-secondary">
                        <Sparkles className="h-4 w-4 text-accent" />
                        <span>{t('today.summary')}</span>
                      </div>
                      <h2 className="text-xl font-semibold tracking-normal">
                        {t('today.summaryTitle')}
                      </h2>
                      <p className="mt-1 text-sm text-foreground-secondary">
                        {payload?.latestBriefing
                          ? t('today.generatedAt', { date: new Date(payload.latestBriefing.briefingDate).toLocaleString() })
                          : t('today.summaryCadence')}
                      </p>
                    </div>
                  </div>

                  {summaryText ? (
                    <div className="prose prose-sm max-w-none text-foreground dark:prose-invert prose-p:text-foreground prose-a:text-accent">
                      <ReactMarkdown>{summaryText}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border bg-background p-5 text-sm text-foreground-secondary">
                      {t('today.noSummaryBody')}
                    </div>
                  )}
                </section>

                {!isLoading && payload?.topTags.length ? (
                  <section className="rounded-xl border border-border bg-background-secondary p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-foreground-secondary">
                      <Hash className="h-3.5 w-3.5 text-accent" />
                      <span>{t('today.tags')}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedTag(null)}
                        className={cn(
                          'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                          !selectedTag
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-border bg-background text-foreground-secondary hover:border-accent hover:text-foreground'
                        )}
                      >
                        {t('today.allTags')}
                      </button>
                      {payload.topTags.map((item) => (
                        <button
                          key={item.tag}
                          type="button"
                          onClick={() => setSelectedTag(item.tag)}
                          className={cn(
                            'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                            selectedTag === item.tag
                              ? 'border-accent bg-accent/10 text-accent'
                              : 'border-border bg-background text-foreground-secondary hover:border-accent hover:text-foreground'
                          )}
                        >
                          {item.tag}
                          <span className="text-[10px] opacity-70">{item.count}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}
              </aside>

              <div
                role="separator"
                aria-label={t('today.resizeBriefing')}
                aria-orientation="vertical"
                onMouseDown={(event) => handleResizeStart('briefing', event)}
                className="hidden cursor-col-resize items-stretch justify-center xl:flex"
              >
                <div className="h-full w-px bg-border transition-colors hover:bg-accent" />
              </div>

              <main className="space-y-5">
                <section className="rounded-xl border border-border bg-background-secondary p-4 md:p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-foreground-secondary">
                        <Flame className="h-4 w-4 text-accent" />
                        <span>{t('today.priorityFeed')}</span>
                      </div>
                      <h2 className="text-xl font-semibold tracking-normal">{t('today.whatMattersNow')}</h2>
                      {payload?.curation && (
                        <p className="mt-1 text-xs text-foreground-secondary">
                          {payload.curation.mode === 'ai'
                            ? t('today.aiCurated', { model: payload.curation.model || 'local model' })
                            : payload.curation.error
                              ? t('today.deterministicFallback')
                              : t('today.deterministicCurated')}
                        </p>
                      )}
                    </div>
                    <div className="text-xs text-foreground-secondary">
                      {payload?.lastIngestedAt ? (
                        <>
                          {t('today.updated')} <RelativeTime date={payload.lastIngestedAt} />
                        </>
                      ) : t('today.notIngested')}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {filteredPriorityItems.length ? filteredPriorityItems.map((item) => (
                      <article
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        ref={(node) => {
                          if (node) {
                            itemRefs.current.set(item.id, node);
                          } else {
                            itemRefs.current.delete(item.id);
                          }
                        }}
                        data-testid="today-priority-item"
                        onClick={() => setSelectedArticle(toArticle(item))}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          setSelectedArticle(toArticle(item));
                        }}
                        className={cn(
                          'block w-full cursor-pointer rounded-lg border bg-background p-3 text-left transition-colors hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40',
                          selectedArticle?.id === item.id ? 'border-accent bg-accent/10' : 'border-border'
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex items-start gap-3">
                            <h3 className="min-w-0 flex-1 text-lg font-semibold leading-snug tracking-normal">{item.title}</h3>
                            <div className="flex shrink-0 items-center gap-1" aria-label="Story preference controls">
                              <button
                                type="button"
                                title="Like this story"
                                aria-label="Like this story"
                                aria-pressed={(item.feedbackValue ?? 0) === 1}
                                disabled={feedbackPendingIds.has(item.id)}
                                onClick={(event) => void handleFeedback(item, 1, event)}
                                className={cn(
                                  'inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:opacity-50',
                                  (item.feedbackValue ?? 0) === 1
                                    ? 'border-accent bg-accent text-[color:var(--accent-foreground)]'
                                    : 'border-border bg-background-secondary text-foreground-secondary hover:border-accent hover:text-foreground'
                                )}
                              >
                                <ThumbsUp className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                title="Dislike this story"
                                aria-label="Dislike this story"
                                aria-pressed={(item.feedbackValue ?? 0) === -1}
                                disabled={feedbackPendingIds.has(item.id)}
                                onClick={(event) => void handleFeedback(item, -1, event)}
                                className={cn(
                                  'inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:opacity-50',
                                  (item.feedbackValue ?? 0) === -1
                                    ? 'border-red-500/70 bg-red-500/15 text-red-300'
                                    : 'border-border bg-background-secondary text-foreground-secondary hover:border-accent hover:text-foreground'
                                )}
                              >
                                <ThumbsDown className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-foreground-secondary">
                            <span>{item.sourceTitle || t('today.unknownSource')}</span>
                            <span aria-hidden="true">•</span>
                            <RelativeTime date={item.publishedAt || item.updatedAt} />
                          </div>
                          {item.summary && (
                            <p className="mt-2 line-clamp-2 text-sm text-foreground-secondary">{item.summary}</p>
                          )}
                        </div>
                      </article>
                    )) : (
                      <div className="rounded-lg border border-dashed border-border bg-background p-5 text-sm text-foreground-secondary">
                        {t('today.noPriorityItems')}
                      </div>
                    )}
                  </div>
                </section>
              </main>

              <div
                role="separator"
                aria-label={t('today.resizeFeed')}
                aria-orientation="vertical"
                onMouseDown={(event) => handleResizeStart('feed', event)}
                className="hidden cursor-col-resize items-stretch justify-center xl:flex"
              >
                <div className="h-full w-px bg-border transition-colors hover:bg-accent" />
              </div>

              <aside className="space-y-5 xl:sticky xl:top-5 xl:self-start">
                {selectedArticle ? (
                  <div className="h-[calc(100dvh-190px)] min-h-[620px] overflow-hidden rounded-xl border border-border bg-background-secondary shadow-xl">
                    <ArticlePreviewPanel article={selectedArticle} onClose={() => setSelectedArticle(null)} />
                  </div>
                ) : (
                  <section className="rounded-xl border border-border bg-background-secondary p-4">
                    <div className="mb-3 text-xs uppercase tracking-[0.22em] text-foreground-secondary">{t('today.summary')}</div>
                    <div className="space-y-2">
                      {briefingSections.slice(0, 3).map((section, index) => (
                        <div key={index} className="rounded-lg border border-border bg-background p-3 text-sm text-foreground-secondary">
                          {section.replace(/^[-*#\s]+/, '')}
                        </div>
                      ))}
                      {briefingSections.length === 0 && (
                        <div className="rounded-lg border border-dashed border-border bg-background p-3 text-sm text-foreground-secondary">
                          {t('today.noBriefingBody')}
                        </div>
                      )}
                    </div>
                  </section>
                )}
              </aside>
            </div>
          )}
        </div>
      </div>
    </AppChrome>
  );
}
