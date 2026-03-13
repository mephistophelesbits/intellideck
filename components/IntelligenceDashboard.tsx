'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Globe2, BrainCircuit, RadioTower, Clock3, MapPinned, Shapes } from 'lucide-react';
import { AppChrome } from '@/components/AppChrome';
import { WorldMapPanel } from '@/components/WorldMapPanel';

type OverviewData = {
  totals: {
    articleCount: number;
    sourceCount: number;
    lastIngestedAt: string | null;
  };
  comparisons: {
    articleDelta: number;
    sourceDelta: number;
  };
  feedHealth: {
    totalFeeds: number;
    healthyFeeds: number;
    failingFeeds: number;
    neverFetchedFeeds: number;
  };
  keywordCloud: Array<{
    id: string;
    label: string;
    value: number;
    score: number;
    category: string;
  }>;
  topMovers: Array<{
    category: string;
    currentCount: number;
    previousCount: number;
    delta: number;
  }>;
  trendSnapshots: Array<{
    label: string;
    value: number;
  }>;
  mapPoints: Array<{
    name: string;
    countryCode: string;
    lat: number;
    lng: number;
    locationType: string;
    mentions: number;
    articleCount: number;
    sourceCount: number;
    primaryCategory: string | null;
    topAnchor: string | null;
    weightedScore: number;
  }>;
  countryHeat: Array<{
    countryCode: string;
    countryName: string;
    mentions: number;
    articleCount: number;
    sourceCount: number;
    weightedScore: number;
    primaryCategory: string | null;
    topAnchor: string | null;
  }>;
  mapLegend: {
    min: number;
    max: number;
  };
  recentArticles: Array<{
    id: string;
    url: string;
    title: string;
    publishedAt: string | null;
    sourceTitle: string | null;
  }>;
  recentFeedErrors: Array<{
    title: string;
    url: string;
    error: string;
    lastFetchedAt: string | null;
  }>;
  storylines: Array<{
    id: string;
    title: string;
    category: string;
    anchorEntity: string | null;
    anchorTheme: string | null;
    storyCount: number;
    sourceCount: number;
    totalImportance: number;
    articles: Array<{
      id: string;
      title: string;
      url: string;
      publishedAt: string | null;
      sourceTitle: string | null;
      importanceScore: number;
    }>;
    entities: Array<{
      name: string;
      mentions: number;
    }>;
    themes: Array<{
      name: string;
      score: number;
    }>;
    locations: Array<{
      name: string;
      mentions: number;
    }>;
  }>;
};

type TrendSeriesData = {
  windowType: string;
  categories: {
    dates: string[];
    series: Array<{ label: string; values: number[] }>;
  };
  locations: {
    dates: string[];
    series: Array<{ label: string; values: number[] }>;
  };
  entities: {
    dates: string[];
    series: Array<{ label: string; values: number[] }>;
  };
  themes: {
    dates: string[];
    series: Array<{ label: string; values: number[] }>;
  };
};

type ThemeDetail = {
  theme: string;
  category: string;
  storyCount: number;
  totalScore: number;
  articles: Array<{
    id: string;
    url: string;
    title: string;
    publishedAt: string | null;
    sourceTitle: string | null;
    importanceScore: number;
    keywordScore: number;
  }>;
  topEntities: Array<{
    name: string;
    mentions: number;
  }>;
};

type LocationDetail = {
  name: string;
  countryCode: string;
  lat: number;
  lng: number;
  locationType: string;
  articles: Array<{
    id: string;
    url: string;
    title: string;
    publishedAt: string | null;
    sourceTitle: string | null;
    mentionCount: number;
  }>;
};

type CountryDetail = {
  countryCode: string;
  countryName: string;
  mentions: number;
  articleCount: number;
  sourceCount: number;
  primaryCategory: string | null;
  topAnchor: string | null;
  articles: Array<{
    id: string;
    url: string;
    title: string;
    publishedAt: string | null;
    sourceTitle: string | null;
    mentionCount: number;
  }>;
};

type MapSelection =
  | { kind: 'city'; key: string }
  | { kind: 'country'; key: string };

type BubbleLayout = {
  id: string;
  label: string;
  value: number;
  score: number;
  category: string;
  radius: number;
  labelSize: number;
  x: number;
  y: number;
  color: string;
};

const BUBBLE_COLORS = [
  '#ff4f00',
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#0ea5e9',
  '#6366f1',
  '#ec4899',
  '#14b8a6',
];

const CATEGORY_COLOR_MAP: Record<string, string> = {
  AI: '#8b5cf6',
  Technology: '#0ea5e9',
  Markets: '#06b6d4',
  Business: '#ef4444',
  Politics: '#10b981',
  World: '#f59e0b',
  Science: '#3b82f6',
  Health: '#ec4899',
  Energy: '#14b8a6',
  Climate: '#22c55e',
  China: '#f97316',
  'Southeast Asia': '#eab308',
  General: '#ff4f00',
};

function getCountryFlag(countryCode: string | null | undefined) {
  if (!countryCode || countryCode.length !== 2) {
    return '';
  }

  return countryCode
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

export function IntelligenceDashboard() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [days, setDays] = useState(7);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingCorpus, setIsRefreshingCorpus] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [isImportingArchive, setIsImportingArchive] = useState(false);
  const [reprocessMessage, setReprocessMessage] = useState<string | null>(null);
  const [selectedBubbleId, setSelectedBubbleId] = useState<string | null>(null);
  const [selectedMapSelection, setSelectedMapSelection] = useState<MapSelection | null>(null);
  const [themeDetail, setThemeDetail] = useState<ThemeDetail | null>(null);
  const [locationDetail, setLocationDetail] = useState<LocationDetail | null>(null);
  const [countryDetail, setCountryDetail] = useState<CountryDetail | null>(null);
  const [trendSeries, setTrendSeries] = useState<TrendSeriesData | null>(null);
  const [bubbleZoom, setBubbleZoom] = useState(1);
  const [bubblePan, setBubblePan] = useState({ x: 0, y: 0 });
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const bubbleDragRef = useRef<{ active: boolean; x: number; y: number; moved: boolean }>({
    active: false,
    x: 0,
    y: 0,
    moved: false,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/intelligence/overview?days=${days}`, { cache: 'no-store' });
        const data = await response.json();
        if (!cancelled) {
          setOverview(data);
          setSelectedBubbleId(data.keywordCloud?.[0]?.id ?? null);
          setSelectedMapSelection(data.countryHeat?.[0]?.countryCode
            ? { kind: 'country', key: data.countryHeat[0].countryCode }
            : data.mapPoints?.[0]?.name
              ? { kind: 'city', key: data.mapPoints[0].name }
              : null);
        }
      } catch (error) {
        console.error('Failed to load intelligence overview:', error);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [days]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`/api/intelligence/trends?days=${days}&lookbackDays=14`, {
          cache: 'no-store',
        });
        const data = await response.json();
        if (!cancelled) {
          setTrendSeries(data);
        }
      } catch (error) {
        console.error('Failed to load trend series:', error);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [days]);

  const bubbleLayouts = useMemo(
    () => buildBubbleLayout(overview?.keywordCloud ?? []),
    [overview?.keywordCloud]
  );

  const selectedBubble = bubbleLayouts.find((bubble) => bubble.id === selectedBubbleId) ?? bubbleLayouts[0] ?? null;
  const selectedPoint = selectedMapSelection?.kind === 'city'
    ? overview?.mapPoints.find((point) => point.name === selectedMapSelection.key) ?? null
    : null;
  const selectedCountry = selectedMapSelection?.kind === 'country'
    ? overview?.countryHeat.find((country) => country.countryCode === selectedMapSelection.key) ?? null
    : null;
  const selectedLocationFlag = getCountryFlag(
    selectedMapSelection?.kind === 'country'
      ? countryDetail?.countryCode ?? selectedCountry?.countryCode
      : selectedPoint?.countryCode,
  );
  const moverDeltaByCategory = useMemo(
    () => new Map((overview?.topMovers ?? []).map((mover) => [mover.category, mover.delta])),
    [overview?.topMovers]
  );

  const selectKeywordForCategory = (category: string) => {
    const match = bubbleLayouts.find((bubble) => bubble.category === category) ?? null;
    if (match) {
      setSelectedBubbleId(match.id);
    }
  };

  const applyBubbleZoom = (deltaY: number) => {
    setBubbleZoom((current) => {
      const next = current + (deltaY > 0 ? -0.12 : 0.12);
      return Math.max(0.7, Math.min(2.4, next));
    });
  };

  const zoomBubbleIn = () => applyBubbleZoom(-1);
  const zoomBubbleOut = () => applyBubbleZoom(1);

  const handleBubblePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    bubbleDragRef.current = {
      active: true,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleBubblePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!bubbleDragRef.current.active) return;
    const deltaX = event.clientX - bubbleDragRef.current.x;
    const deltaY = event.clientY - bubbleDragRef.current.y;

    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
      bubbleDragRef.current.moved = true;
    }

    bubbleDragRef.current.x = event.clientX;
    bubbleDragRef.current.y = event.clientY;

    setBubblePan((current) => ({
      x: Math.max(-220, Math.min(220, current.x + deltaX)),
      y: Math.max(-160, Math.min(160, current.y + deltaY)),
    }));
  };

  const handleBubblePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    bubbleDragRef.current.active = false;
  };

  const handleBubbleSelect = (bubbleId: string) => {
    if (bubbleDragRef.current.moved) {
      bubbleDragRef.current.moved = false;
      return;
    }
    setSelectedBubbleId(bubbleId);
  };

  const resetBubbleViewport = () => {
    setBubbleZoom(1);
    setBubblePan({ x: 0, y: 0 });
  };

  useEffect(() => {
    if (!selectedBubble) {
      setThemeDetail(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/intelligence/themes/${encodeURIComponent(selectedBubble.label)}?days=${days}`, {
          cache: 'no-store',
        });
        const data = await response.json();
        if (!cancelled) {
          setThemeDetail(data);
        }
      } catch (error) {
        console.error('Failed to load theme detail:', error);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedBubble, days]);

  useEffect(() => {
    if (!selectedMapSelection || selectedMapSelection.kind !== 'city') {
      setLocationDetail(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/intelligence/locations/${encodeURIComponent(selectedMapSelection.key)}?days=${days}`, {
          cache: 'no-store',
        });
        const data = await response.json();
        if (!cancelled) {
          setLocationDetail(data);
        }
      } catch (error) {
        console.error('Failed to load location detail:', error);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedMapSelection, days]);

  useEffect(() => {
    if (!selectedMapSelection || selectedMapSelection.kind !== 'country') {
      setCountryDetail(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/intelligence/countries/${encodeURIComponent(selectedMapSelection.key)}?days=${days}`, {
          cache: 'no-store',
        });
        const data = await response.json();
        if (!cancelled) {
          setCountryDetail(data);
        }
      } catch (error) {
        console.error('Failed to load country detail:', error);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedMapSelection, days]);

  const reloadOverview = async () => {
    const [overviewResponse, trendsResponse] = await Promise.all([
      fetch(`/api/intelligence/overview?days=${days}`, { cache: 'no-store' }),
      fetch(`/api/intelligence/trends?days=${days}&lookbackDays=14`, { cache: 'no-store' }),
    ]);
    setOverview(await overviewResponse.json());
    setTrendSeries(await trendsResponse.json());
  };

  const handleRefreshCorpus = async () => {
    setIsRefreshingCorpus(true);
    setReprocessMessage(null);
    try {
      const response = await fetch('/api/intelligence/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Corpus refresh failed');
      }
      setReprocessMessage(`Refreshed ${data.successfulFeeds}/${data.totalFeeds} feeds and ingested ${data.totalArticles} articles.`);
      await reloadOverview();
    } catch (error) {
      console.error('Failed to refresh saved feeds:', error);
      setReprocessMessage(error instanceof Error ? error.message : 'Corpus refresh failed');
    } finally {
      setIsRefreshingCorpus(false);
    }
  };

  const handleReprocess = async () => {
    setIsReprocessing(true);
    setReprocessMessage(null);
    try {
      const response = await fetch('/api/intelligence/reprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 500 }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Reprocess failed');
      }
      setReprocessMessage(`Reprocessed ${data.processedCount} stored articles.`);
      await reloadOverview();
    } catch (error) {
      console.error('Failed to reprocess intelligence corpus:', error);
      setReprocessMessage(error instanceof Error ? error.message : 'Reprocess failed');
    } finally {
      setIsReprocessing(false);
    }
  };

  const handleArchiveImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImportingArchive(true);
    setReprocessMessage(null);

    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const response = await fetch('/api/export/archive/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Archive import failed');
      }
      setReprocessMessage(`Imported archive with ${data.counts.articles} articles and ${data.counts.briefings} briefings.`);
      await reloadOverview();
    } catch (error) {
      console.error('Failed to import archive:', error);
      setReprocessMessage(error instanceof Error ? error.message : 'Archive import failed');
    } finally {
      setIsImportingArchive(false);
      if (archiveInputRef.current) {
        archiveInputRef.current.value = '';
      }
    }
  };

  const actions = (
    <>
      {[1, 3, 7].map((windowDays) => (
        <button
          key={windowDays}
          onClick={() => setDays(windowDays)}
          className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
            days === windowDays
              ? 'border-accent bg-accent text-white'
              : 'border-border hover:border-foreground-secondary'
          }`}
        >
          {windowDays}d
        </button>
      ))}
      <button
        onClick={handleRefreshCorpus}
        disabled={isRefreshingCorpus}
        className="px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium transition-colors hover:border-foreground-secondary disabled:opacity-60"
      >
        {isRefreshingCorpus ? 'Refreshing…' : 'Refresh Corpus'}
      </button>
      <button
        onClick={handleReprocess}
        disabled={isReprocessing}
        className="px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium transition-colors hover:border-foreground-secondary disabled:opacity-60"
      >
        {isReprocessing ? 'Reprocessing…' : 'Reprocess Corpus'}
      </button>
      <a
        href="/api/export/archive"
        className="px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium transition-colors hover:border-foreground-secondary"
      >
        Export Archive
      </a>
      <button
        onClick={() => archiveInputRef.current?.click()}
        disabled={isImportingArchive}
        className="px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium transition-colors hover:border-foreground-secondary disabled:opacity-60"
      >
        {isImportingArchive ? 'Importing…' : 'Import Archive'}
      </button>
      <input
        ref={archiveInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(event) => void handleArchiveImport(event)}
      />
    </>
  );

  return (
    <AppChrome onRefreshAll={handleRefreshCorpus}>
      <div className="h-full overflow-y-auto">
        <div className="w-full px-4 py-4 md:px-5 md:py-5">
          <header className="mb-4 flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold">Intelligence</h1>
              <p className="mt-1 text-xs md:text-sm text-foreground-secondary">
                Server-backed overview of stored articles, categories, locations, and ingest health.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {actions}
            </div>
          </header>

          <div className="space-y-4 md:space-y-5 w-full">
        {reprocessMessage && (
          <div className="rounded-xl border border-border bg-background-secondary px-4 py-3 text-sm text-foreground-secondary">
            {reprocessMessage}
          </div>
        )}

        <div className="grid gap-2 md:grid-cols-4">
          <MetricCard icon={<BrainCircuit className="w-4 h-4" />} label="Articles" value={overview?.totals.articleCount ?? 0} delta={overview?.comparisons.articleDelta} />
          <MetricCard icon={<RadioTower className="w-4 h-4" />} label="Sources" value={overview?.totals.sourceCount ?? 0} delta={overview?.comparisons.sourceDelta} />
          <MetricCard icon={<Globe2 className="w-4 h-4" />} label="Map Points" value={overview?.mapPoints.length ?? 0} />
          <MetricCard
            icon={<Clock3 className="w-4 h-4" />}
            label="Last Ingested"
            value={overview?.totals.lastIngestedAt ? new Date(overview.totals.lastIngestedAt).toLocaleString() : 'N/A'}
          />
        </div>

        {/* Row 1: Keyword Cloud + World Map */}
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <section className="rounded-2xl border border-border bg-background-secondary p-4">
            <div className="flex items-center gap-2 mb-2">
              <Shapes className="w-4 h-4 text-accent" />
              <h2 className="text-lg font-medium">Keyword Cloud</h2>
            </div>
            <p className="text-xs md:text-sm text-foreground-secondary mb-4">
              Bubble size reflects keyword prevalence in the selected window. Keywords are color-coded by dominant category.
            </p>
            {isLoading ? (
              <p className="text-sm text-foreground-secondary">Loading overview…</p>
            ) : (
              <div
                className="rounded-2xl border border-border bg-background h-[420px] md:h-[500px] overflow-hidden"
                onWheel={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  applyBubbleZoom(event.deltaY);
                }}
              >
                <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs text-foreground-secondary">
                  <span>Drag to pan. Scroll to zoom.</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={zoomBubbleOut}
                      className="rounded-md border border-border px-2 py-1 transition-colors hover:border-foreground-secondary"
                      aria-label="Zoom out keyword cloud"
                    >
                      -
                    </button>
                    <button
                      type="button"
                      onClick={zoomBubbleIn}
                      className="rounded-md border border-border px-2 py-1 transition-colors hover:border-foreground-secondary"
                      aria-label="Zoom in keyword cloud"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={resetBubbleViewport}
                      className="rounded-md border border-border px-2 py-1 transition-colors hover:border-foreground-secondary"
                    >
                      Reset view
                    </button>
                  </div>
                </div>
                <svg
                  viewBox="0 0 760 420"
                  className="h-[calc(100%-41px)] w-full touch-none select-none"
                  onPointerDown={handleBubblePointerDown}
                  onPointerMove={handleBubblePointerMove}
                  onPointerUp={handleBubblePointerUp}
                  onPointerLeave={handleBubblePointerUp}
                >
                  <defs>
                    <linearGradient id="bubbleBg" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="rgba(255,255,255,0.10)" />
                      <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
                    </linearGradient>
                  </defs>
                  <rect x="0" y="0" width="760" height="420" fill="transparent" />
                  <g transform={`translate(${bubblePan.x} ${bubblePan.y}) scale(${bubbleZoom})`}>
                    {bubbleLayouts.map((bubble) => {
                      const active = selectedBubble?.id === bubble.id;
                      return (
                        <g
                          key={bubble.id}
                          transform={`translate(${bubble.x}, ${bubble.y})`}
                          className="cursor-pointer"
                          onPointerDown={(event) => event.stopPropagation()}
                          onPointerUp={(event) => {
                            event.stopPropagation();
                            handleBubbleSelect(bubble.id);
                          }}
                        >
                          <circle
                            r={bubble.radius + (active ? 6 : 0)}
                            fill={bubble.color}
                            fillOpacity={active ? 0.22 : 0.12}
                            stroke={bubble.color}
                            strokeWidth={active ? 2.5 : 1.25}
                          />
                          <circle
                            r={Math.max(16, bubble.radius * 0.72)}
                            fill="url(#bubbleBg)"
                            stroke="transparent"
                          />
                          <text
                            textAnchor="middle"
                            y={bubble.label.length > 14 ? 0 : 4}
                            className="fill-current"
                            style={{
                              fontSize: `${bubble.labelSize}px`,
                              fontWeight: 700,
                            }}
                          >
                            {truncateLabel(
                              bubble.label,
                              bubble.radius > 88 ? 20 : bubble.radius > 68 ? 16 : bubble.radius > 52 ? 12 : 10
                            )}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </svg>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-background-secondary p-4">
            <div className="flex items-center gap-2 mb-2">
              <MapPinned className="w-4 h-4 text-accent" />
              <h2 className="text-lg font-medium">World Map</h2>
            </div>
            <p className="text-xs md:text-sm text-foreground-secondary mb-4">
              Geographic distribution of article coverage. Click a country or city to inspect location details.
            </p>
            <div className="h-[420px] md:h-[500px] rounded-2xl border border-border bg-[#05070b] overflow-hidden">
              <WorldMapPanel
                points={overview?.mapPoints ?? []}
                countryHeat={overview?.countryHeat ?? []}
                mapLegend={overview?.mapLegend ?? { min: 0, max: 0 }}
                selectedSelection={selectedMapSelection}
                onSelect={(selection) => setSelectedMapSelection(selection)}
              />
            </div>
          </section>
        </div>

        {/* Row 2: Keyword Category + Country Coverage */}
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <section className="rounded-2xl border border-border bg-background-secondary p-4">
            <div className="flex items-center gap-2 mb-2">
              <Shapes className="w-4 h-4 text-accent" />
              <h2 className="text-lg font-medium">Keyword Category</h2>
            </div>
            <p className="text-xs md:text-sm text-foreground-secondary mb-4">
              Importance-ranked feed coverage for the selected keyword.
            </p>
            <div className="rounded-2xl border border-border bg-background h-[420px] md:h-[500px] overflow-hidden p-4">
              {themeDetail && selectedBubble ? (
                <div className="flex h-full min-h-0 flex-col space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xl font-semibold">{themeDetail.theme}</div>
                      <div className="mt-1 text-sm text-foreground-secondary">
                        {themeDetail.category} · {themeDetail.storyCount} stories · score {themeDetail.totalScore.toFixed(1)}
                      </div>
                    </div>
                    <div
                      className="h-12 w-12 rounded-full border-2"
                      style={{ borderColor: selectedBubble.color, backgroundColor: `${selectedBubble.color}33` }}
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded-xl border border-border bg-background-secondary px-3 py-2">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">Category</div>
                      <div className="mt-1 font-medium">{themeDetail.category}</div>
                    </div>
                    <div className="rounded-xl border border-border bg-background-secondary px-3 py-2">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">Stories</div>
                      <div className="mt-1 font-medium">{themeDetail.storyCount}</div>
                    </div>
                    <div className="rounded-xl border border-border bg-background-secondary px-3 py-2">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">Keyword Score</div>
                      <div className="mt-1 font-medium">{themeDetail.totalScore.toFixed(1)}</div>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
                    {themeDetail.articles.map((article, index) => (
                      <a
                        key={article.id}
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded-xl border border-border bg-background-secondary p-2.5 hover:border-accent transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-foreground-secondary mb-1">
                              {index + 1}. {article.sourceTitle || 'Unknown Source'}
                            </div>
                            <div className="font-medium leading-snug">{article.title}</div>
                          </div>
                          <div className="text-right text-xs text-foreground-secondary whitespace-nowrap">
                            <div>Importance {article.importanceScore.toFixed(1)}</div>
                            <div>Keyword {article.keywordScore.toFixed(1)}</div>
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex h-[420px] items-center justify-center text-sm text-foreground-secondary">
                  Select a keyword bubble to inspect its category details.
                </div>
              )}
            </div>
          </section>

          <div className="space-y-4">
            <section className="rounded-2xl border border-border bg-background-secondary p-4">
              <h2 className="text-lg font-medium mb-4">
                {selectedLocationFlag ? `${selectedLocationFlag} ` : ''}
                {selectedMapSelection?.kind === 'country' && countryDetail
                  ? `${countryDetail.countryName} Summary`
                  : locationDetail
                    ? `${locationDetail.name} Summary`
                    : 'Location Summary'}
              </h2>
              {selectedMapSelection?.kind === 'country' && countryDetail ? (
                <div className="flex gap-3">
                  <div className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-center">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">Articles</div>
                    <div className="mt-1 text-xl font-semibold">{countryDetail.articleCount}</div>
                  </div>
                  <div className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-center">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">Mentions</div>
                    <div className="mt-1 text-xl font-semibold">{countryDetail.mentions}</div>
                  </div>
                  <div className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-center">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">Sources</div>
                    <div className="mt-1 text-xl font-semibold">{countryDetail.sourceCount}</div>
                  </div>
                </div>
              ) : locationDetail && selectedPoint ? (
                <div className="flex gap-3">
                  <div className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-center">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">Articles</div>
                    <div className="mt-1 text-xl font-semibold">{selectedPoint.articleCount}</div>
                  </div>
                  <div className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-center">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">Mentions</div>
                    <div className="mt-1 text-xl font-semibold">{selectedPoint.mentions}</div>
                  </div>
                  <div className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-center">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">Country</div>
                    <div className="mt-1 text-xl font-semibold">{selectedPoint.countryCode}</div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-background px-4 py-6 text-sm text-foreground-secondary">
                  Select a country or city on the map to inspect the location summary.
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-border bg-background-secondary p-4">
              <h2 className="text-lg font-medium mb-4">
                {selectedMapSelection?.kind === 'country' && countryDetail
                  ? `${countryDetail.countryName} Coverage`
                  : locationDetail
                    ? `${locationDetail.name} Coverage`
                    : 'Location Coverage'}
              </h2>
              <div className="space-y-2.5 max-h-[372px] overflow-y-auto pr-1">
                {((selectedMapSelection?.kind === 'country' ? countryDetail?.articles : locationDetail?.articles) ?? []).map((article) => (
                  <a
                    key={article.id}
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-xl border border-border bg-background p-2.5 hover:border-accent transition-colors"
                  >
                    <div className="font-medium">{article.title}</div>
                    <div className="text-xs text-foreground-secondary mt-1">
                      {article.sourceTitle || 'Unknown Source'} · {article.mentionCount} mentions
                    </div>
                  </a>
                ))}
                {!countryDetail && !locationDetail && (
                  <p className="text-sm text-foreground-secondary">Select a country or city on the map to inspect coverage.</p>
                )}
              </div>
            </section>
          </div>
        </div>

        <section className="rounded-2xl border border-border bg-background-secondary p-4">
          <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
            <div>
              <h2 className="text-lg font-medium">Trend Monitor</h2>
              <p className="text-sm text-foreground-secondary mt-1">
                Compare the current window against the previous {days}-day window and inspect the latest persisted snapshot.
              </p>
            </div>
          </div>
          <div className="grid items-start gap-3 2xl:grid-cols-2">
            <div className="rounded-2xl border border-border bg-background p-3 2xl:h-[440px]">
              <div className="text-xs uppercase tracking-[0.24em] text-foreground-secondary mb-3">Latest Snapshot</div>
              <div className="space-y-1.5 2xl:max-h-[388px] 2xl:overflow-y-auto pr-1">
                {(overview?.trendSnapshots ?? []).map((snapshot) => (
                  <div key={snapshot.label} className="space-y-1">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <button
                        type="button"
                        onClick={() => selectKeywordForCategory(snapshot.label)}
                        className="text-left font-medium transition-colors hover:text-accent"
                      >
                        {snapshot.label}
                      </button>
                      <span className="text-foreground-secondary">
                        {snapshot.value}
                        {typeof moverDeltaByCategory.get(snapshot.label) === 'number' && (
                          <span
                            className={`ml-2 font-medium ${
                              (moverDeltaByCategory.get(snapshot.label) ?? 0) >= 0 ? 'text-success' : 'text-error'
                            }`}
                          >
                            {(moverDeltaByCategory.get(snapshot.label) ?? 0) >= 0 ? '+' : ''}
                            {moverDeltaByCategory.get(snapshot.label)}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-background-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.max(8, Math.min(100, snapshot.value * 10))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <TrendPanel
              title="Category Series"
              dates={trendSeries?.categories.dates ?? []}
              series={trendSeries?.categories.series ?? []}
              className="2xl:h-[440px]"
            />
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-background-secondary p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shapes className="w-4 h-4 text-accent" />
            <h2 className="text-lg font-medium">Storylines</h2>
          </div>
          <p className="text-xs md:text-sm text-foreground-secondary mb-4">
            Cross-source clusters built from category plus shared entity anchors, to surface developing stories instead of isolated articles.
          </p>
          <div className="grid gap-3 xl:grid-cols-2">
            {(overview?.storylines ?? []).map((storyline) => (
              <div key={storyline.id} className="rounded-2xl border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-base font-semibold">{storyline.title}</div>
                    <div className="text-xs text-foreground-secondary mt-1">
                      {storyline.category} · {storyline.storyCount} stories · {storyline.sourceCount} sources
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-background-secondary px-3 py-2 text-right">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">Weight</div>
                    <div className="text-sm font-medium">{Math.round(storyline.totalImportance)}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {storyline.entities.slice(0, 4).map((entity) => (
                    <span key={entity.name} className="rounded-full border border-border bg-background-secondary px-3 py-1 text-xs">
                      {entity.name} · {entity.mentions}
                    </span>
                  ))}
                  {storyline.themes.slice(0, 3).map((theme) => (
                    <span key={theme.name} className="rounded-full border border-border bg-accent/10 px-3 py-1 text-xs text-accent">
                      {theme.name}
                    </span>
                  ))}
                  {storyline.locations.slice(0, 2).map((location) => (
                    <span key={location.name} className="rounded-full border border-border bg-background-secondary px-3 py-1 text-xs text-foreground-secondary">
                      {location.name}
                    </span>
                  ))}
                </div>
                <div className="mt-3 space-y-2">
                  {storyline.articles.slice(0, 3).map((article, index) => (
                    <a
                      key={article.id}
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-xl border border-border bg-background-secondary p-2.5 hover:border-accent transition-colors"
                    >
                      <div className="text-xs text-foreground-secondary mb-1">
                        {index + 1}. {article.sourceTitle || 'Unknown Source'}
                      </div>
                      <div className="font-medium leading-snug">{article.title}</div>
                    </a>
                  ))}
                </div>
              </div>
            ))}
            {(overview?.storylines?.length ?? 0) === 0 && (
              <p className="text-sm text-foreground-secondary">Not enough related coverage yet to form storylines.</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-background-secondary p-4">
          <h2 className="text-lg font-medium mb-4">Recent Stored Articles</h2>
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {overview?.recentArticles.map((article) => (
              <a
                key={article.url}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-xl border border-border bg-background p-3 hover:border-accent transition-colors"
              >
                <div className="font-medium leading-snug">{article.title}</div>
                <div className="text-xs text-foreground-secondary mt-2">
                  {article.sourceTitle || 'Unknown Source'} · {article.publishedAt ? new Date(article.publishedAt).toLocaleString() : 'No date'}
                </div>
              </a>
            ))}
          </div>
        </section>
          </div>
        </div>
      </div>
    </AppChrome>
  );
}

function MetricCard({ icon, label, value, delta }: { icon: React.ReactNode; label: string; value: React.ReactNode; delta?: number }) {
  return (
    <div className="rounded-xl border border-border bg-background/70 px-3 py-2.5 backdrop-blur-sm">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-foreground-secondary">
        <span className="opacity-80">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-1.5 text-lg md:text-xl font-semibold leading-tight break-words">{value}</div>
      {typeof delta === 'number' && (
        <div className={`mt-1 text-[11px] font-medium ${delta >= 0 ? 'text-success' : 'text-error'}`}>
          {delta >= 0 ? '+' : ''}{delta}
        </div>
      )}
    </div>
  );
}

function buildBubbleLayout(bubbles: Array<{ id: string; label: string; value: number; score: number; category: string }>): BubbleLayout[] {
  const sorted = [...bubbles].sort((a, b) => b.score - a.score || b.value - a.value);
  const centerX = 250;
  const centerY = 200;
  const minValue = Math.min(...sorted.map((bubble) => bubble.value), 0);
  const maxValue = Math.max(...sorted.map((bubble) => bubble.value), 1);
  const minScore = Math.min(...sorted.map((bubble) => bubble.score), 0);
  const maxScore = Math.max(...sorted.map((bubble) => bubble.score), 1);

  return sorted.map((bubble, index) => {
    const normalizedValue = normalizeMetric(bubble.value, minValue, maxValue);
    const normalizedScore = normalizeMetric(bubble.score, minScore, maxScore);
    const emphasis = normalizedScore * 0.6 + normalizedValue * 0.4;
    const radius = 34 + emphasis * 92;
    const labelSize = 10 + emphasis * 14;
    const color = CATEGORY_COLOR_MAP[bubble.category] || BUBBLE_COLORS[index % BUBBLE_COLORS.length];
    if (index === 0) {
      return {
        ...bubble,
        radius,
        labelSize,
        x: centerX,
        y: centerY,
        color,
      };
    }

    const ring = Math.ceil(index / 5);
    const angle = (index * 1.18) % (Math.PI * 2);
    const orbit = 78 + ring * 66;

    return {
      ...bubble,
      radius,
      labelSize,
      x: centerX + Math.cos(angle) * orbit + (index % 2 === 0 ? 24 : -18),
      y: centerY + Math.sin(angle) * orbit + ((index % 3) - 1) * 18,
      color,
    };
  });
}

function truncateLabel(label: string, maxLength: number) {
  if (label.length <= maxLength) return label;
  return `${label.slice(0, maxLength - 1)}…`;
}

function normalizeMetric(value: number, min: number, max: number) {
  if (max <= min) {
    return 0.5;
  }

  return (value - min) / (max - min);
}

function TrendPanel({
  title,
  dates,
  series,
  className,
}: {
  title: string;
  dates: string[];
  series: Array<{ label: string; values: number[] }>;
  className?: string;
}) {
  const width = 360;
  const height = 180;
  const padding = 24;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const maxValue = Math.max(1, ...series.flatMap((item) => item.values));

  return (
    <div className={`rounded-2xl border border-border bg-background p-3 ${className ?? ''} flex min-h-0 flex-col`}>
      <div className="text-sm font-medium mb-2.5">{title}</div>
      {series.length === 0 || dates.length === 0 ? (
        <p className="text-sm text-foreground-secondary">Not enough history yet.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} className="h-[190px] w-full flex-shrink-0">
            <rect width={width} height={height} fill="transparent" />
            {[0, 1, 2, 3].map((tick) => {
              const y = padding + (chartHeight / 3) * tick;
              return (
                <line
                  key={`grid-${tick}`}
                  x1={padding}
                  x2={width - padding}
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.08)"
                  strokeDasharray="4 6"
                />
              );
            })}
            {series.map((item, index) => {
              const color = BUBBLE_COLORS[index % BUBBLE_COLORS.length];
              const points = item.values.map((value, valueIndex) => {
                const x = padding + (chartWidth / Math.max(1, dates.length - 1)) * valueIndex;
                const y = height - padding - (value / maxValue) * chartHeight;
                return `${x},${y}`;
              }).join(' ');

              return (
                <g key={item.label}>
                  <polyline
                    fill="none"
                    stroke={color}
                    strokeWidth="3"
                    points={points}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {item.values.map((value, valueIndex) => {
                    const x = padding + (chartWidth / Math.max(1, dates.length - 1)) * valueIndex;
                    const y = height - padding - (value / maxValue) * chartHeight;
                    return <circle key={`${item.label}-${dates[valueIndex]}`} cx={x} cy={y} r="3.5" fill={color} />;
                  })}
                </g>
              );
            })}
          </svg>
          <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {series.map((item, index) => (
              <div key={`legend-${item.label}`} className="flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: BUBBLE_COLORS[index % BUBBLE_COLORS.length] }}
                  />
                  <span className="truncate">{item.label}</span>
                </div>
                <span className="text-foreground-secondary">{item.values[item.values.length - 1]}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
