'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ExternalLink,
  Gauge,
  Maximize2,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type AmbientCard = {
  id: string;
  title: string;
  source: string;
  type: 'Market' | 'AI' | 'Ops' | 'World' | 'Product' | 'Signal';
  urgency: 'critical' | 'important' | 'watch' | 'context';
  summary: string;
  details: string;
  score: number;
  minutesAgo: number;
  trend: string;
  accent: string;
  url?: string;
  publishedAt?: string | null;
  feedContent?: string | null;
  contentSnippet?: string | null;
  origin?: 'real' | 'mock' | 'live';
};

type AmbientFeedArticle = {
  id: string;
  title: string;
  url: string;
  originalPublishedAt: string | null;
  publishedAt: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  contentSnippet: string | null;
  content: string | null;
};

type AmbientFeedResponse = {
  items: AmbientFeedArticle[];
  totalFeeds: number;
  successfulFeeds: number;
  failedFeeds: number;
  refreshedAt: string;
};

type ScrapedArticle = {
  title: string;
  content: string;
  textContent: string;
  excerpt: string;
  byline: string | null;
  siteName: string | null;
  length: number;
};

const seedCards: AmbientCard[] = [
  {
    id: 'feed-001',
    title: 'Open-source model release is spreading through developer channels',
    source: 'AI Radar',
    type: 'AI',
    urgency: 'critical',
    summary: 'Multiple repos and benchmark notes point to a release with strong local inference interest.',
    details:
      'The important part is distribution velocity. Mentions are clustering around quantized builds, agent workflows, and desktop deployment. Track compatibility notes and adoption in the next update window.',
    score: 96,
    minutesAgo: 4,
    trend: '+38% mentions',
    accent: '#ef4444',
    origin: 'mock',
  },
  {
    id: 'feed-002',
    title: 'Semiconductor names are moving before guidance updates',
    source: 'Market Desk',
    type: 'Market',
    urgency: 'important',
    summary: 'Supplier commentary and options flow are both leaning toward higher volatility today.',
    details:
      'The signal is not a single price move. It is the combination of supplier language, elevated options volume, and renewed AI infrastructure demand expectations.',
    score: 88,
    minutesAgo: 9,
    trend: 'High volatility',
    accent: '#f59e0b',
    origin: 'mock',
  },
  {
    id: 'feed-003',
    title: 'RSS ingestion latency crossed the alert threshold',
    source: 'IntelliDeck Ops',
    type: 'Ops',
    urgency: 'critical',
    summary: 'A subset of high-priority feeds has not refreshed inside the expected window.',
    details:
      'The prototype marks operational cards as larger because they often require action. A production version would include retry status, affected sources, and owner routing.',
    score: 94,
    minutesAgo: 12,
    trend: '7 feeds delayed',
    accent: '#fb7185',
    origin: 'mock',
  },
  {
    id: 'feed-004',
    title: 'New briefing theme detected: private AI workspaces',
    source: 'Briefing Agent',
    type: 'Signal',
    urgency: 'important',
    summary: 'Articles from product, security, and enterprise sources are converging on one theme.',
    details:
      'The theme appears across unrelated feeds, which makes it more useful than a simple keyword hit. This is a good candidate for an auto-generated briefing.',
    score: 84,
    minutesAgo: 16,
    trend: 'Cross-source cluster',
    accent: '#14b8a6',
    origin: 'mock',
  },
  {
    id: 'feed-005',
    title: 'Regional cloud providers announce new GPU capacity',
    source: 'World Tech',
    type: 'World',
    urgency: 'watch',
    summary: 'The announcements are small individually, but together they suggest capacity is decentralizing.',
    details:
      'The broader signal is geographic. More compute is being marketed outside the largest hyperscaler regions, which may affect price, latency, and data residency options.',
    score: 71,
    minutesAgo: 22,
    trend: '3 regions',
    accent: '#38bdf8',
    origin: 'mock',
  },
  {
    id: 'feed-006',
    title: 'A competitor shipped a cleaner research workspace',
    source: 'Product Watch',
    type: 'Product',
    urgency: 'important',
    summary: 'The new interface emphasizes saved searches, summaries, and reusable knowledge trails.',
    details:
      'This is relevant to IntelliDeck because the workflow overlaps with briefings and intelligence search. The full version should compare feature depth and interaction speed.',
    score: 82,
    minutesAgo: 27,
    trend: 'Product overlap',
    accent: '#a78bfa',
    origin: 'mock',
  },
  {
    id: 'feed-007',
    title: 'Policy discussion is shifting from models to deployment environments',
    source: 'Policy Feed',
    type: 'World',
    urgency: 'watch',
    summary: 'Regulatory language is focusing more on where AI systems run and who audits them.',
    details:
      'The shift matters because tooling, observability, and data controls become part of the policy surface. This could influence enterprise buying criteria.',
    score: 67,
    minutesAgo: 34,
    trend: 'Policy drift',
    accent: '#60a5fa',
    origin: 'mock',
  },
  {
    id: 'feed-008',
    title: 'Saved search found three articles matching customer-risk keywords',
    source: 'Search Monitor',
    type: 'Signal',
    urgency: 'critical',
    summary: 'The matches are recent and come from sources that normally have low noise.',
    details:
      'A production card could expose the matching snippets and a one-click briefing action. This prototype uses the same idea to test visibility and priority.',
    score: 91,
    minutesAgo: 39,
    trend: 'Keyword hit',
    accent: '#f97316',
    origin: 'mock',
  },
  {
    id: 'feed-009',
    title: 'Calendar gap opens a ninety-minute briefing window',
    source: 'Personal Ops',
    type: 'Ops',
    urgency: 'context',
    summary: 'A low-conflict slot appears later today for deep review work.',
    details:
      'Ambient cards do not need to be only news. The wall can mix external intelligence with personal operating signals when ranking keeps the surface calm.',
    score: 58,
    minutesAgo: 44,
    trend: 'Focus slot',
    accent: '#22c55e',
    origin: 'mock',
  },
  {
    id: 'feed-010',
    title: 'Two long reads are being repeatedly cited by technical newsletters',
    source: 'Reading Queue',
    type: 'AI',
    urgency: 'watch',
    summary: 'The citation pattern suggests these pieces may shape developer opinion this week.',
    details:
      'The current card is a compact watch item. If citations continue, the score would increase and the next version would promote it into a larger card.',
    score: 64,
    minutesAgo: 51,
    trend: 'Citation rise',
    accent: '#ec4899',
    origin: 'mock',
  },
  {
    id: 'feed-011',
    title: 'Database export completed with no failed records',
    source: 'Archive Job',
    type: 'Ops',
    urgency: 'context',
    summary: 'Nightly archive health is clean and storage usage remains within target.',
    details:
      'Context cards should stay visible enough to reassure but should not compete with urgent signals. This card demonstrates the lower-priority visual treatment.',
    score: 42,
    minutesAgo: 63,
    trend: 'Healthy',
    accent: '#10b981',
    origin: 'mock',
  },
  {
    id: 'feed-012',
    title: 'Founder interviews mention a new pattern: small teams buying agent tools',
    source: 'Startup Scanner',
    type: 'Market',
    urgency: 'watch',
    summary: 'The customer language is converging around speed, memory, and private data handling.',
    details:
      'This is a strategic signal rather than a breaking item. It belongs on the wall because repeated weak signals can become a stronger product thesis.',
    score: 69,
    minutesAgo: 71,
    trend: 'Demand signal',
    accent: '#06b6d4',
    origin: 'mock',
  },
];

const incomingCards: AmbientCard[] = [
  {
    id: 'live-001',
    title: 'Breaking cluster: enterprise AI security spending is accelerating',
    source: 'Live Signal',
    type: 'Market',
    urgency: 'critical',
    summary: 'Three fresh sources mention budget movement toward auditability and private deployments.',
    details:
      'This card was injected by the simulated live feed. In a real system it would be created by ranking new articles against user-defined priorities and source trust.',
    score: 98,
    minutesAgo: 1,
    trend: 'Live cluster',
    accent: '#ef4444',
    origin: 'live',
  },
  {
    id: 'live-002',
    title: 'New anomaly: one source is publishing duplicate items',
    source: 'Feed Health',
    type: 'Ops',
    urgency: 'important',
    summary: 'Duplicate detection is catching similar titles from a single endpoint.',
    details:
      'Operational anomalies are useful in the wall because they surface silent data quality issues before they poison briefings and trend analysis.',
    score: 86,
    minutesAgo: 2,
    trend: 'Dedup needed',
    accent: '#f97316',
    origin: 'live',
  },
  {
    id: 'live-003',
    title: 'A low-noise source just published a major product teardown',
    source: 'Research Feed',
    type: 'Product',
    urgency: 'important',
    summary: 'The article is early and unusually detailed, with screenshots and pricing notes.',
    details:
      'Source quality can boost priority even when social velocity is still low. That is the kind of ranking behavior this prototype is meant to test.',
    score: 89,
    minutesAgo: 3,
    trend: 'Fresh teardown',
    accent: '#8b5cf6',
    origin: 'live',
  },
];

const typeStyles: Record<AmbientCard['type'], string> = {
  AI: 'border-violet-400/45 bg-violet-400/10 text-violet-100',
  Market: 'border-amber-300/45 bg-amber-300/10 text-amber-100',
  Ops: 'border-rose-300/45 bg-rose-300/10 text-rose-100',
  Product: 'border-sky-300/45 bg-sky-300/10 text-sky-100',
  Signal: 'border-teal-300/45 bg-teal-300/10 text-teal-100',
  World: 'border-blue-300/45 bg-blue-300/10 text-blue-100',
};

const urgencyLabel: Record<AmbientCard['urgency'], string> = {
  critical: 'Critical',
  important: 'Important',
  watch: 'Watch',
  context: 'Context',
};

const categoryColorMap: Record<string, string> = {
  AI: '#8b5cf6',
  Technology: '#0ea5e9',
  Markets: '#f59e0b',
  Business: '#ef4444',
  World: '#60a5fa',
  Politics: '#fb7185',
  Science: '#14b8a6',
  Health: '#22c55e',
  Energy: '#f97316',
  General: '#94a3b8',
};

function timeLabel(minutesAgo: number) {
  if (minutesAgo < 60) return `${minutesAgo}m`;
  const hours = Math.floor(minutesAgo / 60);
  return `${hours}h`;
}

function cardScale(card: AmbientCard) {
  if (card.score >= 90) return 'break-inside-avoid mb-4 min-h-[360px] p-6';
  if (card.score >= 78) return 'break-inside-avoid mb-4 min-h-[300px] p-5';
  if (card.score >= 62) return 'break-inside-avoid mb-4 min-h-[240px] p-5';
  return 'break-inside-avoid mb-4 min-h-[190px] p-4';
}

function titleScale(card: AmbientCard) {
  if (card.score >= 90) return 'text-[clamp(2.15rem,3.6vw,4.8rem)] leading-[0.94]';
  if (card.score >= 78) return 'text-[clamp(1.75rem,2.65vw,3.5rem)] leading-[0.98]';
  if (card.score >= 62) return 'text-[clamp(1.35rem,2vw,2.55rem)] leading-[1]';
  return 'text-[clamp(1.05rem,1.45vw,1.8rem)] leading-[1.08]';
}

function parsePublishedAt(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  const normalized = value.replace(/(\d{2}:\d{2}:\d{2})\s+([+-]\d{4})$/, '$1 GMT$2');
  const normalizedParsed = Date.parse(normalized);
  return Number.isFinite(normalizedParsed) ? normalizedParsed : null;
}

function minutesSince(value: string | null) {
  const timestamp = parsePublishedAt(value);
  if (!timestamp) return 999;
  return Math.max(1, Math.floor((Date.now() - timestamp) / 60000));
}

function urgencyFromScore(score: number): AmbientCard['urgency'] {
  if (score >= 90) return 'critical';
  if (score >= 76) return 'important';
  if (score >= 58) return 'watch';
  return 'context';
}

function typeFromArticle(article: AmbientFeedArticle): AmbientCard['type'] {
  const normalized = `${article.title} ${article.sourceTitle ?? ''}`.toLowerCase();
  if (normalized.includes('ai')) return 'AI';
  if (
    normalized.includes('market') ||
    normalized.includes('stock') ||
    normalized.includes('business') ||
    normalized.includes('funding') ||
    normalized.includes('earnings')
  ) {
    return 'Market';
  }
  if (
    normalized.includes('tech') ||
    normalized.includes('software') ||
    normalized.includes('apple') ||
    normalized.includes('google') ||
    normalized.includes('github')
  ) {
    return 'Product';
  }
  if (
    normalized.includes('world') ||
    normalized.includes('policy') ||
    normalized.includes('china') ||
    normalized.includes('ukraine') ||
    normalized.includes('election')
  ) {
    return 'World';
  }
  if (normalized.includes('outage') || normalized.includes('error') || normalized.includes('status')) return 'Ops';
  return 'Signal';
}

function signalBoost(article: AmbientFeedArticle) {
  const text = `${article.title} ${stripHtml(article.contentSnippet || article.content)} ${article.sourceTitle ?? ''}`.toLowerCase();
  let boost = 0;

  if (/\b(breaking|urgent|alert|launch|released|ships|announces|acquires|funding|earnings|security|breach|outage)\b/.test(text)) {
    boost += 8;
  }
  if (/\b(ai|agent|model|openai|anthropic|google|apple|nvidia|amd|market|policy|war|election)\b/.test(text)) {
    boost += 6;
  }
  if (/\b(views|likes|rt|heat)\b/.test(text)) {
    boost += 4;
  }
  if ((article.contentSnippet?.length ?? 0) > 120 || (article.content?.length ?? 0) > 400) {
    boost += 3;
  }

  return boost;
}

function scoreFromArticle(article: AmbientFeedArticle, minutesAgo: number, index: number) {
  const recencyScore = minutesAgo < 30 ? 88 : minutesAgo < 120 ? 82 : minutesAgo < 360 ? 74 : minutesAgo < 1440 ? 64 : 50;
  const positionPenalty = Math.min(index, 40) * 0.25;
  return Math.max(36, Math.min(98, Math.round(recencyScore + signalBoost(article) - positionPenalty)));
}

function stripHtml(value: string | null | undefined) {
  if (!value) return '';
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function excerptFromArticle(article: AmbientFeedArticle) {
  const content = stripHtml(article.contentSnippet || article.content);
  if (!content) return 'Fresh item from your saved feeds.';
  return content.length > 180 ? `${content.slice(0, 177)}...` : content;
}

function mapFeedToCards(feed: AmbientFeedResponse): AmbientCard[] {
  const articleCards = feed.items.map((article, index) => {
    const ageMinutes = minutesSince(article.publishedAt);
    const score = scoreFromArticle(article, ageMinutes, index);
    const type = typeFromArticle(article);

    return {
      id: `article-${article.id}`,
      title: article.title,
      source: article.sourceTitle || 'Saved feed',
      type,
      urgency: urgencyFromScore(score),
      summary: excerptFromArticle(article),
      details: stripHtml(article.content || article.contentSnippet) || `Published ${timeLabel(ageMinutes)} ago from ${article.sourceTitle || 'a saved feed'}.`,
      score,
      minutesAgo: ageMinutes,
      trend: 'Latest',
      accent: type === 'AI' ? categoryColorMap.AI : type === 'Market' ? categoryColorMap.Markets : type === 'World' ? categoryColorMap.World : '#14b8a6',
      url: article.url,
      publishedAt: article.publishedAt,
      feedContent: article.content,
      contentSnippet: article.contentSnippet,
      origin: 'real' as const,
    } satisfies AmbientCard;
  });

  const healthCards: AmbientCard[] =
    feed.failedFeeds > 0
      ? [
          {
            id: 'feed-health',
            title: `${feed.failedFeeds} saved feeds need attention`,
            source: 'IntelliDeck Ops',
            type: 'Ops',
            urgency: 'context',
            summary: `${feed.successfulFeeds} of ${feed.totalFeeds} feeds refreshed successfully. Failed feeds may hide important cards.`,
            details:
              'This operational card is generated from the latest Feed Wall refresh.',
            score: 44,
            minutesAgo: minutesSince(feed.refreshedAt),
            trend: 'Feed health',
            accent: '#f97316',
            origin: 'real',
          },
        ]
      : [];

  return [...healthCards, ...articleCards];
}

function paragraphsFromText(value: string) {
  return value
    .split(/\n{2,}|\r{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 16);
}

function isTweetUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const host = new URL(value).hostname.replace(/^www\./, '');
    return host === 'twitter.com' || host === 'x.com';
  } catch {
    return false;
  }
}

async function loadFullContent(url: string, signal: AbortSignal) {
  const attempts = isTweetUrl(url) ? ['/api/tweet', '/api/scrape'] : ['/api/scrape'];
  let lastError = 'Failed to load full content';

  for (const endpoint of attempts) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal,
      });
      const data = await response.json().catch(() => ({}));
      const article = data.article || data.tweet;
      if (response.ok && article?.textContent) {
        return article as ScrapedArticle;
      }
      lastError = data.error || lastError;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      lastError = error instanceof Error ? error.message : lastError;
    }
  }

  throw new Error(lastError);
}

type AmbientWallPrototypeProps = {
  embedded?: boolean;
};

export function AmbientWallPrototype({ embedded = false }: AmbientWallPrototypeProps) {
  const [cards, setCards] = useState(seedCards);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [interactionPaused, setInteractionPaused] = useState(false);
  const [speed, setSpeed] = useState(0.34);
  const [liveIndex, setLiveIndex] = useState(0);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => new Set());
  const [feedMode, setFeedMode] = useState<'loading' | 'real' | 'fallback'>('loading');
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [scrapedByUrl, setScrapedByUrl] = useState<
    Record<string, { status: 'loading' | 'success' | 'error'; article?: ScrapedArticle; error?: string }>
  >({});
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const firstLoopRef = useRef<HTMLDivElement | null>(null);
  const scrollAccumulatorRef = useRef(0);
  const interactionPauseTimerRef = useRef<number | null>(null);

  const selectedIndex = useMemo(
    () => cards.findIndex((card) => card.id === selectedId),
    [cards, selectedId]
  );
  const selectedCard = selectedIndex >= 0 ? cards[selectedIndex] : null;
  const isMoving = !paused && !interactionPaused && !selectedCard;

  const loadLatestFeedCards = useCallback(async () => {
    try {
      const response = await fetch('/api/ambient?limit=160', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Feed Wall request failed: ${response.status}`);
      const feed = (await response.json()) as AmbientFeedResponse;
      const latestCards = mapFeedToCards(feed);
      if (latestCards.length === 0) {
        setCards(seedCards);
        setFeedMode('fallback');
      } else {
        setCards(latestCards);
        setFeedMode('real');
      }
      setLastLoadedAt(new Date());
    } catch (error) {
      console.error('Failed to load latest Feed Wall cards:', error);
      setCards(seedCards);
      setFeedMode('fallback');
      setLastLoadedAt(new Date());
    }
  }, []);

  const rankedCards = useMemo(() => {
    return [...cards].sort((a, b) => {
      const pinDelta = Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id));
      if (pinDelta !== 0) return pinDelta;
      return b.score - a.score;
    });
  }, [cards, pinnedIds]);

  const selectRelative = useCallback(
    (direction: -1 | 1) => {
      if (selectedIndex < 0) return;
      const nextIndex = (selectedIndex + direction + cards.length) % cards.length;
      setSelectedId(cards[nextIndex].id);
    },
    [cards, selectedIndex]
  );

  useEffect(() => {
    let frame = 0;
    const step = () => {
      const scroller = scrollerRef.current;
      const firstLoop = firstLoopRef.current;
      if (scroller && firstLoop && isMoving) {
        scrollAccumulatorRef.current += speed;
        const loopHeight = firstLoop.offsetHeight;
        if (loopHeight > 0 && scrollAccumulatorRef.current >= loopHeight) {
          scrollAccumulatorRef.current -= loopHeight;
        }
        scroller.scrollTop = scrollAccumulatorRef.current;
      }
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [isMoving, speed, rankedCards.length]);

  useEffect(() => {
    void loadLatestFeedCards();
    const timer = window.setInterval(() => void loadLatestFeedCards(), 120000);
    return () => window.clearInterval(timer);
  }, [loadLatestFeedCards]);

  useEffect(() => {
    if (!selectedCard?.url) return;
    const url = selectedCard.url;
    const existing = scrapedByUrl[url];
    if (existing?.status === 'loading' || existing?.status === 'success') return;

    const controller = new AbortController();
    setScrapedByUrl((current) => ({
      ...current,
      [url]: { status: 'loading' },
    }));

    loadFullContent(url, controller.signal)
      .then((article) => {
        setScrapedByUrl((current) => ({
          ...current,
          [url]: { status: 'success', article },
        }));
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setScrapedByUrl((current) => ({
          ...current,
          [url]: {
            status: 'error',
            error: error instanceof Error ? error.message : 'Failed to load full article',
          },
        }));
      });

    return () => controller.abort();
  }, [scrapedByUrl, selectedCard]);

  useEffect(() => {
    if (selectedCard || feedMode === 'real') return;

    const timer = window.setInterval(() => {
      const next = incomingCards[liveIndex % incomingCards.length];
      const stamped = {
        ...next,
        id: `${next.id}-${Date.now()}`,
        minutesAgo: 1,
      };
      setCards((current) => [stamped, ...current].slice(0, 18));
      setLiveIndex((index) => index + 1);
    }, 12000);

    return () => window.clearInterval(timer);
  }, [feedMode, liveIndex, selectedCard]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedId(null);
      if (event.key === ' ') {
        event.preventDefault();
        setPaused((value) => !value);
      }
      if (!selectedCard) return;
      if (event.key === 'ArrowRight') selectRelative(1);
      if (event.key === 'ArrowLeft') selectRelative(-1);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectRelative, selectedCard]);

  const markRead = (id: string) => {
    setReadIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePin = (id: string) => {
    setPinnedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetFeed = () => {
    void loadLatestFeedCards();
    setLiveIndex(0);
    setReadIds(new Set());
    setPinnedIds(new Set());
    scrollAccumulatorRef.current = 0;
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  };

  const pauseAfterManualScroll = () => {
    setInteractionPaused(true);
    window.setTimeout(() => {
      if (scrollerRef.current) {
        scrollAccumulatorRef.current = scrollerRef.current.scrollTop;
      }
    }, 0);
    if (interactionPauseTimerRef.current) {
      window.clearTimeout(interactionPauseTimerRef.current);
    }
    interactionPauseTimerRef.current = window.setTimeout(() => {
      setInteractionPaused(false);
      interactionPauseTimerRef.current = null;
    }, 2500);
  };

  useEffect(() => {
    return () => {
      if (interactionPauseTimerRef.current) {
        window.clearTimeout(interactionPauseTimerRef.current);
      }
    };
  }, []);

  const renderCard = (card: AmbientCard, duplicate = false) => {
    const isRead = readIds.has(card.id);
    const isPinned = pinnedIds.has(card.id);

    return (
      <article
        key={`${card.id}-${duplicate ? 'loop' : 'main'}`}
        className={cn(
          'group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border border-white/10 bg-[#14161d] text-white shadow-[0_16px_50px_rgba(0,0,0,0.26)] transition duration-300 hover:-translate-y-0.5 hover:border-white/25 focus:outline-none focus:ring-2 focus:ring-white/60',
          cardScale(card),
          isRead && 'opacity-55'
        )}
        style={{
          borderTopColor: card.accent,
          borderTopWidth: 5,
        }}
        tabIndex={duplicate ? -1 : 0}
        onClick={() => !duplicate && setSelectedId(card.id)}
        onKeyDown={(event) => {
          if (!duplicate && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            setSelectedId(card.id);
          }
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-normal',
                typeStyles[card.type]
              )}
            >
              {card.type}
            </span>
            <span className="truncate text-xs font-semibold uppercase tracking-normal text-white/48">
              {card.source}
            </span>
          </div>
          <span className="shrink-0 text-xs font-bold uppercase tracking-normal text-white/45">
            {timeLabel(card.minutesAgo)}
          </span>
        </div>

        <div className="mt-5 flex flex-1 flex-col justify-between gap-6">
          <h2 className={cn('max-w-[16ch] break-words font-black tracking-normal text-white', titleScale(card))}>
            {card.title}
          </h2>
          <div className="space-y-4">
            <p className="max-w-[46ch] text-[clamp(0.98rem,1.15vw,1.25rem)] leading-snug text-white/70">
              {card.summary}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-normal">
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-white/64">
                {urgencyLabel[card.urgency]}
              </span>
              <span className="rounded-full px-2.5 py-1 text-black" style={{ backgroundColor: card.accent }}>
                {card.trend}
              </span>
              {isPinned && <span className="rounded-full bg-white px-2.5 py-1 text-black">Pinned</span>}
              {card.origin === 'real' && <span className="rounded-full bg-white px-2.5 py-1 text-black">Real</span>}
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="absolute right-3 top-3 rounded-full bg-black/35 p-2 text-white backdrop-blur">
            <Maximize2 className="h-4 w-4" />
          </div>
        </div>
      </article>
    );
  };

  const selectedScrape = selectedCard?.url ? scrapedByUrl[selectedCard.url] : undefined;
  const selectedHeadline = selectedScrape?.article?.title || selectedCard?.title || '';
  const selectedExcerpt = selectedScrape?.article?.excerpt || selectedCard?.summary || '';
  const selectedFallbackText = stripHtml(selectedCard?.feedContent || selectedCard?.contentSnippet || selectedCard?.details);
  const selectedFullText = selectedScrape?.article?.textContent || selectedFallbackText;
  const selectedParagraphs = paragraphsFromText(selectedFullText);
  const hasFallbackContent = selectedFallbackText.length > 0;

  return (
    <main className={cn('relative overflow-hidden bg-[#08090d] text-white', embedded ? 'h-full' : 'h-[100dvh]')}>
      <div className="absolute inset-x-0 top-0 z-20 border-b border-white/10 bg-[#08090d]/92 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-black">
              <Radio className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-black tracking-normal text-white md:text-2xl">
                Feed Wall
              </h1>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-normal text-white/46">
                <span>{cards.length} cards</span>
                <span className="h-1 w-1 rounded-full bg-white/25" />
                <span>{feedMode === 'real' ? 'Latest saved feeds' : feedMode === 'loading' ? 'Loading latest feeds' : 'Prototype feed'}</span>
                <span className="h-1 w-1 rounded-full bg-white/25" />
                <span>{isMoving ? 'Live scroll' : 'Paused'}</span>
                {lastLoadedAt && (
                  <>
                    <span className="h-1 w-1 rounded-full bg-white/25" />
                    <span>Loaded {lastLoadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 md:flex">
              <Gauge className="h-4 w-4 text-white/54" />
              <input
                aria-label="Scroll speed"
                className="h-1.5 w-28 accent-white"
                type="range"
                min="0.12"
                max="0.7"
                step="0.02"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
              />
            </div>
            <button
              type="button"
              title={paused ? 'Resume' : 'Pause'}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-white transition hover:bg-white/12"
              onClick={() => setPaused((value) => !value)}
            >
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </button>
            <button
              type="button"
              title="Reset feed"
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-white transition hover:bg-white/12"
              onClick={resetFeed}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="absolute inset-0 overflow-y-auto px-4 pb-10 pt-24 md:px-6 lg:px-8"
        onWheel={pauseAfterManualScroll}
      >
        <section ref={firstLoopRef} className="columns-1 gap-4 sm:columns-2 xl:columns-3 2xl:columns-4">
          {rankedCards.map((card) => renderCard(card))}
        </section>
        <section aria-hidden className="columns-1 gap-4 pt-4 sm:columns-2 xl:columns-3 2xl:columns-4">
          {rankedCards.map((card) => renderCard(card, true))}
        </section>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-28 bg-gradient-to-t from-[#08090d] to-transparent" />

      {selectedCard && (
        <div className="fixed inset-0 z-50 flex bg-[#07080c] text-white">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 md:px-6">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-normal',
                    typeStyles[selectedCard.type]
                  )}
                >
                  {selectedCard.type}
                </span>
                <span className="truncate text-sm font-bold uppercase tracking-normal text-white/50">
                  {selectedCard.source}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  title="Previous"
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] transition hover:bg-white/12"
                  onClick={() => selectRelative(-1)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="Next"
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] transition hover:bg-white/12"
                  onClick={() => selectRelative(1)}
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title={readIds.has(selectedCard.id) ? 'Mark unread' : 'Mark read'}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] transition hover:bg-white/12"
                  onClick={() => markRead(selectedCard.id)}
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title={pinnedIds.has(selectedCard.id) ? 'Unpin' : 'Pin'}
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] transition hover:bg-white/12',
                    pinnedIds.has(selectedCard.id) && 'bg-white text-black hover:bg-white/90'
                  )}
                  onClick={() => togglePin(selectedCard.id)}
                >
                  <Bookmark className="h-4 w-4" />
                </button>
                {selectedCard.url && (
                  <a
                    title="Open source"
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] transition hover:bg-white/12"
                    href={selectedCard.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                <button
                  type="button"
                  title="Close"
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white text-black transition hover:bg-white/90"
                  onClick={() => setSelectedId(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] overflow-y-auto md:grid-cols-[minmax(0,1fr)_360px] md:grid-rows-1">
              <section className="flex min-h-[60dvh] flex-col justify-center px-5 py-8 md:px-10 lg:px-14">
                <div
                  className="mb-5 h-1.5 w-28 rounded-full"
                  style={{ backgroundColor: selectedCard.accent }}
                />
                <h2 className="max-w-[12ch] break-words text-[clamp(2.6rem,6.6vw,7.5rem)] font-black leading-[0.92] tracking-normal text-white">
                  {selectedHeadline}
                </h2>
                <p className="mt-8 max-w-3xl text-[clamp(1.2rem,2vw,2rem)] leading-tight text-white/70">
                  {selectedExcerpt}
                </p>
              </section>

              <aside className="overflow-y-auto border-t border-white/10 bg-white/[0.04] p-5 md:border-l md:border-t-0 md:p-6">
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="Score" value={selectedCard.score.toString()} />
                  <Metric label="Freshness" value={timeLabel(selectedCard.minutesAgo)} />
                  <Metric label="Priority" value={urgencyLabel[selectedCard.urgency]} />
                  <Metric label="Trend" value={selectedCard.trend} />
                </div>

                <div className="mt-8 space-y-4">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-normal text-white/45">
                    <Sparkles className="h-4 w-4" />
                    <span>Full Content</span>
                  </div>
                  {selectedScrape?.status === 'loading' && hasFallbackContent && (
                    <p className="text-sm leading-snug text-white/42">Pulling richer source content...</p>
                  )}
                  {selectedScrape?.status === 'loading' && !hasFallbackContent && (
                    <p className="text-lg leading-snug text-white/62">Pulling source content...</p>
                  )}
                  {selectedScrape?.status === 'error' && (
                    <div className="space-y-3">
                      <p className="text-sm font-bold uppercase tracking-normal text-amber-200">
                        Showing feed content
                      </p>
                      <p className="text-sm leading-snug text-white/48">
                        Source fetch failed: {selectedScrape.error}
                      </p>
                    </div>
                  )}
                  {selectedParagraphs.length > 0 ? (
                    <div className="space-y-4 text-base leading-relaxed text-white/78">
                      {selectedParagraphs.map((paragraph, index) => (
                        <p key={`${selectedCard.id}-paragraph-${index}`}>{paragraph}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-lg leading-snug text-white/78">{selectedCard.details}</p>
                  )}
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="text-[11px] font-bold uppercase tracking-normal text-white/42">{label}</div>
      <div className="mt-2 text-xl font-black tracking-normal text-white">{value}</div>
    </div>
  );
}
