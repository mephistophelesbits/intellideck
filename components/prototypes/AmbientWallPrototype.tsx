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
  origin?: 'real' | 'mock' | 'live';
};

type OverviewArticle = {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  sourceTitle: string | null;
  importanceScore?: number;
};

type OverviewStoryline = {
  id: string;
  title: string;
  category: string;
  anchorEntity: string | null;
  anchorTheme: string | null;
  storyCount: number;
  sourceCount: number;
  totalImportance: number;
  articles: OverviewArticle[];
};

type IntelligenceOverview = {
  totals: {
    articleCount: number;
    sourceCount: number;
    lastIngestedAt: string | null;
  };
  feedHealth: {
    totalFeeds: number;
    healthyFeeds: number;
    failingFeeds: number;
    neverFetchedFeeds: number;
  };
  recentArticles: OverviewArticle[];
  storylines: OverviewStoryline[];
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

function typeFromCategory(category: string): AmbientCard['type'] {
  const normalized = category.toLowerCase();
  if (normalized.includes('ai')) return 'AI';
  if (normalized.includes('market') || normalized.includes('business') || normalized.includes('energy')) return 'Market';
  if (normalized.includes('tech') || normalized.includes('science')) return 'Product';
  if (normalized.includes('world') || normalized.includes('politic')) return 'World';
  if (normalized.includes('health')) return 'Signal';
  return 'Signal';
}

function scoreFromImportance(importance: number | undefined, fallback = 54) {
  if (!Number.isFinite(importance)) return fallback;
  return Math.max(42, Math.min(98, Math.round((importance ?? fallback) * 0.72)));
}

function mapOverviewToCards(overview: IntelligenceOverview): AmbientCard[] {
  const storylineCards = overview.storylines.slice(0, 10).map((storyline) => {
    const lead = storyline.articles[0];
    const leadScore = scoreFromImportance(lead?.importanceScore, 72);
    const sourceLabel =
      storyline.sourceCount > 1 ? `${storyline.sourceCount} sources` : lead?.sourceTitle || 'Intelligence';
    const category = storyline.category || 'General';
    const theme = storyline.anchorTheme || storyline.anchorEntity || category;

    return {
      id: `storyline-${storyline.id}`,
      title: lead?.title || storyline.title,
      source: sourceLabel,
      type: typeFromCategory(category),
      urgency: urgencyFromScore(leadScore),
      summary: `${storyline.storyCount} related articles clustered around ${theme}.`,
      details: `Top cluster: ${storyline.articles
        .slice(0, 4)
        .map((article) => article.title)
        .join(' / ')}`,
      score: leadScore,
      minutesAgo: minutesSince(lead?.publishedAt ?? overview.totals.lastIngestedAt),
      trend: `${storyline.storyCount} stories`,
      accent: categoryColorMap[category] ?? '#38bdf8',
      url: lead?.url,
      origin: 'real' as const,
    } satisfies AmbientCard;
  });

  const recentArticleCards = overview.recentArticles.slice(0, 12).map((article) => {
    const ageMinutes = minutesSince(article.publishedAt);
    const recencyBoost = ageMinutes < 180 ? 24 : ageMinutes < 1440 ? 14 : ageMinutes < 4320 ? 6 : 0;
    const score = scoreFromImportance(article.importanceScore, 48 + recencyBoost);

    return {
      id: `article-${article.id}`,
      title: article.title,
      source: article.sourceTitle || 'Recent article',
      type: 'Signal',
      urgency: urgencyFromScore(score),
      summary: 'Recent item from your IntelliDeck feed, promoted by freshness and source context.',
      details: `Published ${timeLabel(ageMinutes)} ago from ${article.sourceTitle || 'an unknown source'}.`,
      score,
      minutesAgo: ageMinutes,
      trend: 'Recent',
      accent: '#14b8a6',
      url: article.url,
      origin: 'real' as const,
    } satisfies AmbientCard;
  });

  const healthCards: AmbientCard[] =
    overview.feedHealth.failingFeeds > 0
      ? [
          {
            id: 'feed-health',
            title: `${overview.feedHealth.failingFeeds} saved feeds need attention`,
            source: 'IntelliDeck Ops',
            type: 'Ops',
            urgency: 'important',
            summary: `${overview.feedHealth.healthyFeeds} of ${overview.feedHealth.totalFeeds} feeds are healthy. Failed feeds may hide important cards.`,
            details:
              'This operational card is generated from the feed health summary in the intelligence overview endpoint.',
            score: 84,
            minutesAgo: minutesSince(overview.totals.lastIngestedAt),
            trend: 'Feed health',
            accent: '#f97316',
            origin: 'real',
          },
        ]
      : [];

  const deduped = new Map<string, AmbientCard>();
  [...healthCards, ...storylineCards, ...recentArticleCards].forEach((card) => {
    if (!deduped.has(card.title)) deduped.set(card.title, card);
  });

  return [...deduped.values()]
    .sort((a, b) => b.score - a.score || a.minutesAgo - b.minutesAgo)
    .slice(0, 20);
}

type AmbientWallPrototypeProps = {
  embedded?: boolean;
};

export function AmbientWallPrototype({ embedded = false }: AmbientWallPrototypeProps) {
  const [cards, setCards] = useState(seedCards);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [speed, setSpeed] = useState(0.34);
  const [liveIndex, setLiveIndex] = useState(0);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => new Set());
  const [feedMode, setFeedMode] = useState<'loading' | 'real' | 'fallback'>('loading');
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const firstLoopRef = useRef<HTMLDivElement | null>(null);

  const selectedIndex = useMemo(
    () => cards.findIndex((card) => card.id === selectedId),
    [cards, selectedId]
  );
  const selectedCard = selectedIndex >= 0 ? cards[selectedIndex] : null;
  const isMoving = !paused && !hoverPaused && !selectedCard;

  const loadOverviewCards = useCallback(async () => {
    try {
      const response = await fetch('/api/intelligence/overview?days=14', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Overview request failed: ${response.status}`);
      const overview = (await response.json()) as IntelligenceOverview;
      const overviewCards = mapOverviewToCards(overview);
      if (overviewCards.length === 0) {
        setCards(seedCards);
        setFeedMode('fallback');
      } else {
        setCards(overviewCards);
        setFeedMode('real');
      }
      setLastLoadedAt(new Date());
    } catch (error) {
      console.error('Failed to load ambient overview cards:', error);
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
        scroller.scrollTop += speed;
        const loopHeight = firstLoop.offsetHeight;
        if (loopHeight > 0 && scroller.scrollTop >= loopHeight) {
          scroller.scrollTop -= loopHeight;
        }
      }
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [isMoving, speed, rankedCards.length]);

  useEffect(() => {
    void loadOverviewCards();
    const timer = window.setInterval(() => void loadOverviewCards(), 60000);
    return () => window.clearInterval(timer);
  }, [loadOverviewCards]);

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
    void loadOverviewCards();
    setLiveIndex(0);
    setReadIds(new Set());
    setPinnedIds(new Set());
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  };

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
                Ambient Feed Wall
              </h1>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-normal text-white/46">
                <span>{cards.length} cards</span>
                <span className="h-1 w-1 rounded-full bg-white/25" />
                <span>{feedMode === 'real' ? 'IntelliDeck feed' : feedMode === 'loading' ? 'Loading' : 'Prototype feed'}</span>
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
        onMouseEnter={() => setHoverPaused(true)}
        onMouseLeave={() => setHoverPaused(false)}
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
                <h2 className="max-w-[12ch] break-words text-[clamp(3rem,8vw,9rem)] font-black leading-[0.9] tracking-normal text-white">
                  {selectedCard.title}
                </h2>
                <p className="mt-8 max-w-3xl text-[clamp(1.2rem,2vw,2rem)] leading-tight text-white/70">
                  {selectedCard.summary}
                </p>
              </section>

              <aside className="border-t border-white/10 bg-white/[0.04] p-5 md:border-l md:border-t-0 md:p-6">
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="Score" value={selectedCard.score.toString()} />
                  <Metric label="Freshness" value={timeLabel(selectedCard.minutesAgo)} />
                  <Metric label="Priority" value={urgencyLabel[selectedCard.urgency]} />
                  <Metric label="Trend" value={selectedCard.trend} />
                </div>

                <div className="mt-8 space-y-4">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-normal text-white/45">
                    <Sparkles className="h-4 w-4" />
                    <span>Brief</span>
                  </div>
                  <p className="text-lg leading-snug text-white/78">{selectedCard.details}</p>
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
