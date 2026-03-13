'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import worldAtlas from 'world-atlas/countries-110m.json';
import { getThemeById, useSettingsStore } from '@/lib/settings-store';

type MapPoint = {
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
};

type CountryHeat = {
  countryCode: string;
  countryName: string;
  mentions: number;
  articleCount: number;
  sourceCount: number;
  weightedScore: number;
  primaryCategory: string | null;
  topAnchor: string | null;
};

type MapSelection =
  | { kind: 'city'; key: string }
  | { kind: 'country'; key: string }
  | null;

type TooltipState = {
  x: number;
  y: number;
  title: string;
  meta: string;
  detail: string;
} | null;

type WorldMapPanelProps = {
  points: MapPoint[];
  countryHeat: CountryHeat[];
  mapLegend: {
    min: number;
    max: number;
  };
  selectedSelection: MapSelection;
  onSelect: (selection: Exclude<MapSelection, null>) => void;
};

type CountryFeature = {
  type: string;
  properties: { name: string };
  geometry: unknown;
};

const VIEWBOX_WIDTH = 1100;
const VIEWBOX_HEIGHT = 620;
const VIEWBOX_CENTER_X = VIEWBOX_WIDTH / 2;
const VIEWBOX_CENTER_Y = VIEWBOX_HEIGHT / 2;
const COUNTRIES = (feature(
  worldAtlas as never,
  (worldAtlas as { objects: { countries: unknown } }).objects.countries as never
) as unknown as { features: CountryFeature[] }).features;

const projection = geoNaturalEarth1().fitExtent(
  [
    [20, 24],
    [VIEWBOX_WIDTH - 20, VIEWBOX_HEIGHT - 24],
  ],
  { type: 'FeatureCollection', features: COUNTRIES } as never
);

const pathGenerator = geoPath(projection);

const COUNTRY_NAME_OVERRIDES: Record<string, string> = {
  US: 'United States of America',
  GB: 'United Kingdom',
  KR: 'South Korea',
  RU: 'Russia',
  TW: 'Taiwan',
  HK: 'Hong Kong',
  VN: 'Vietnam',
  LA: 'Laos',
  IR: 'Iran',
};

function normalizeCountryName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function buildHeatColor(score: number, min: number, max: number) {
  if (max <= min) return 'rgba(251,146,60,0.14)';
  const ratio = Math.max(0, Math.min(1, (score - min) / (max - min)));
  const alpha = 0.12 + ratio * 0.62;
  return `rgba(249, 115, 22, ${alpha.toFixed(3)})`;
}

function withAlpha(hex: string, alpha: number) {
  const normalized = hex.replace('#', '');
  const fullHex = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(fullHex)) {
    return `rgba(255, 255, 255, ${alpha})`;
  }

  const red = parseInt(fullHex.slice(0, 2), 16);
  const green = parseInt(fullHex.slice(2, 4), 16);
  const blue = parseInt(fullHex.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getCountryDisplayName(code: string, fallback: string) {
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
    return displayNames.of(code) || fallback;
  } catch {
    return fallback;
  }
}

function projectPoint(lat: number, lng: number) {
  return projection([lng, lat]);
}

export function WorldMapPanel({ points, countryHeat, mapLegend, selectedSelection, onSelect }: WorldMapPanelProps) {
  const themeId = useSettingsStore((state) => state.themeId);
  const theme = getThemeById(themeId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef({ active: false, x: 0, y: 0, moved: false });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [activeLayer, setActiveLayer] = useState<'heat' | 'cities' | 'external'>('heat');

  const heatByName = useMemo(() => {
    const map = new Map<string, CountryHeat>();
    for (const entry of countryHeat) {
      const atlasName = COUNTRY_NAME_OVERRIDES[entry.countryCode] || entry.countryName || getCountryDisplayName(entry.countryCode, entry.countryCode);
      map.set(normalizeCountryName(atlasName), entry);
      map.set(normalizeCountryName(entry.countryName), entry);
      map.set(normalizeCountryName(getCountryDisplayName(entry.countryCode, entry.countryCode)), entry);
    }
    return map;
  }, [countryHeat]);

  const plottedCities = useMemo(
    () =>
      points
        .filter((point) => point.locationType === 'city')
        .map((point) => {
          const projected = projectPoint(point.lat, point.lng);
          return projected
            ? {
                ...point,
                x: projected[0],
                y: projected[1],
                radius: Math.max(4, Math.min(14, 4 + point.weightedScore * 0.18)),
              }
            : null;
        })
        .filter(Boolean) as Array<MapPoint & { x: number; y: number; radius: number }>,
    [points]
  );

  const mapPalette = useMemo(() => ({
    background: theme.isDark ? '#05070b' : theme.background,
    panelBackground: theme.isDark ? 'rgba(5, 7, 11, 0.9)' : withAlpha(theme.background, 0.94),
    panelBorder: theme.isDark ? 'rgba(255,255,255,0.1)' : withAlpha(theme.border, 0.2),
    panelText: theme.isDark ? '#cbd5e1' : theme.foregroundSecondary,
    countryBaseFill: theme.isDark ? '#121821' : withAlpha(theme.foregroundSecondary, 0.08),
    countryBaseStroke: theme.isDark ? '#2d3748' : withAlpha(theme.border, 0.5),
    countryActiveStroke: theme.isDark ? '#fff7ed' : theme.foreground,
    countryMatchedStroke: withAlpha(theme.accent, theme.isDark ? 0.82 : 0.64),
    markerFill: theme.accent,
    markerFillInactive: withAlpha(theme.accent, theme.isDark ? 0.78 : 0.64),
    markerGlow: withAlpha(theme.accent, theme.isDark ? 0.18 : 0.16),
    markerSelectedGlow: withAlpha(theme.accent, theme.isDark ? 0.28 : 0.22),
    markerStroke: theme.isDark ? '#fed7aa' : '#ffffff',
    markerSelectedStroke: theme.isDark ? '#fff7ed' : theme.foreground,
  }), [theme]);

  const buildThemeHeatColor = (score: number) => {
    if (mapLegend.max <= mapLegend.min) {
      return withAlpha(theme.accent, theme.isDark ? 0.16 : 0.18);
    }
    const ratio = Math.max(0, Math.min(1, (score - mapLegend.min) / (mapLegend.max - mapLegend.min)));
    const alpha = theme.isDark ? 0.12 + ratio * 0.62 : 0.12 + ratio * 0.38;
    return withAlpha(theme.accent, Number(alpha.toFixed(3)));
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = {
      active: true,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current.active) return;
    const deltaX = event.clientX - dragRef.current.x;
    const deltaY = event.clientY - dragRef.current.y;
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
      dragRef.current.moved = true;
    }
    dragRef.current.x = event.clientX;
    dragRef.current.y = event.clientY;
    setPan((current) => ({
      x: Math.max(-260, Math.min(260, current.x + deltaX)),
      y: Math.max(-180, Math.min(180, current.y + deltaY)),
    }));
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current.active = false;
  };

  const applyMapZoom = (deltaY: number) => {
    setZoom((current) => Math.max(0.8, Math.min(2.8, current + (deltaY > 0 ? -0.12 : 0.12))));
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((current) => Math.max(0.8, Math.min(2.8, current + (event.deltaY > 0 ? -0.12 : 0.12))));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const zoomMapIn = () => applyMapZoom(-1);
  const zoomMapOut = () => applyMapZoom(1);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const updateTooltip = (
    event: React.MouseEvent<SVGElement | HTMLButtonElement>,
    title: string,
    meta: string,
    detail: string
  ) => {
    if (!containerRef.current) return;
    const bounds = containerRef.current.getBoundingClientRect();
    setTooltip({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      title,
      meta,
      detail,
    });
  };

  return (
    <div
      ref={containerRef}
      className="relative h-[420px] md:h-[500px] overflow-hidden rounded-2xl border border-border"
      style={{ backgroundColor: mapPalette.background }}
    >
      <div
        className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 border-b px-3 py-2 text-xs backdrop-blur"
        style={{
          borderColor: mapPalette.panelBorder,
          backgroundColor: mapPalette.panelBackground,
          color: mapPalette.panelText,
        }}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveLayer('heat')}
            className="rounded-md border px-2 py-1 transition-colors"
            style={activeLayer === 'heat'
              ? {
                  borderColor: withAlpha(theme.accent, 0.6),
                  backgroundColor: withAlpha(theme.accent, theme.isDark ? 0.16 : 0.12),
                  color: theme.foreground,
                }
              : {
                  borderColor: mapPalette.panelBorder,
                }}
          >
            Country Heat
          </button>
          <button
            type="button"
            onClick={() => setActiveLayer('cities')}
            className="rounded-md border px-2 py-1 transition-colors"
            style={activeLayer === 'cities'
              ? {
                  borderColor: withAlpha(theme.accent, 0.6),
                  backgroundColor: withAlpha(theme.accent, theme.isDark ? 0.16 : 0.12),
                  color: theme.foreground,
                }
              : {
                  borderColor: mapPalette.panelBorder,
                }}
          >
            City Markers
          </button>
          <button
            type="button"
            disabled
            className="rounded-md border px-2 py-1"
            style={{
              borderColor: mapPalette.panelBorder,
              color: withAlpha(theme.foregroundSecondary, 0.72),
            }}
          >
            External Events
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span>Drag to pan. Scroll to zoom.</span>
          <button
            type="button"
            onClick={zoomMapOut}
            className="rounded-md border px-2 py-1"
            style={{ borderColor: mapPalette.panelBorder }}
            aria-label="Zoom out map"
          >
            -
          </button>
          <button
            type="button"
            onClick={zoomMapIn}
            className="rounded-md border px-2 py-1"
            style={{ borderColor: mapPalette.panelBorder }}
            aria-label="Zoom in map"
          >
            +
          </button>
          <button type="button" onClick={resetView} className="rounded-md border px-2 py-1" style={{ borderColor: mapPalette.panelBorder }}>
            Reset view
          </button>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        className="h-full w-full touch-none select-none pt-[41px]"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <rect width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill={mapPalette.background} />
        <g
          transform={`translate(${VIEWBOX_CENTER_X + pan.x} ${VIEWBOX_CENTER_Y + pan.y}) scale(${zoom}) translate(${-VIEWBOX_CENTER_X} ${-VIEWBOX_CENTER_Y})`}
        >
          {COUNTRIES.map((country) => {
            const name = country.properties?.name ?? '';
            const matched = heatByName.get(normalizeCountryName(name));
            const isSelected = selectedSelection?.kind === 'country' && matched?.countryCode === selectedSelection.key;
            const countryPath = pathGenerator(country as never);
            if (!countryPath) return null;

            return (
              <path
                key={name}
                d={countryPath}
                fill={activeLayer === 'heat' && matched ? buildThemeHeatColor(matched.weightedScore) : mapPalette.countryBaseFill}
                stroke={isSelected ? mapPalette.countryActiveStroke : matched ? mapPalette.countryMatchedStroke : mapPalette.countryBaseStroke}
                strokeWidth={isSelected ? 1.8 : 0.8}
                className={matched ? 'cursor-pointer transition-opacity' : ''}
                onPointerDown={(event) => matched && event.stopPropagation()}
                onPointerUp={(event) => {
                  if (!matched) return;
                  event.stopPropagation();
                  onSelect({ kind: 'country', key: matched.countryCode });
                }}
                onMouseMove={(event) => {
                  if (!matched) return;
                  updateTooltip(
                    event,
                    matched.countryName || getCountryDisplayName(matched.countryCode, name),
                    `${matched.articleCount} articles · ${matched.mentions} mentions · ${matched.sourceCount} sources`,
                    [matched.primaryCategory, matched.topAnchor].filter(Boolean).join(' · ') || 'Country heat'
                  );
                }}
                onMouseLeave={() => setTooltip(null)}
              />
            );
          })}

          {(activeLayer === 'heat' || activeLayer === 'cities') &&
            plottedCities.map((point) => {
              const isSelected = selectedSelection?.kind === 'city' && selectedSelection.key === point.name;
              return (
                <g
                  key={`${point.countryCode}-${point.name}`}
                  transform={`translate(${point.x}, ${point.y})`}
                  className="cursor-pointer"
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerUp={(event) => {
                    event.stopPropagation();
                    onSelect({ kind: 'city', key: point.name });
                  }}
                  onMouseMove={(event) =>
                    updateTooltip(
                      event,
                      point.name,
                      `${point.articleCount} articles · ${point.mentions} mentions`,
                      [point.primaryCategory, point.topAnchor].filter(Boolean).join(' · ') || point.countryCode
                    )
                  }
                  onMouseLeave={() => setTooltip(null)}
                >
                  <circle
                    r={point.radius + (isSelected ? 4 : 2)}
                    fill={isSelected ? mapPalette.markerSelectedGlow : mapPalette.markerGlow}
                    stroke="none"
                  />
                  <circle
                    r={point.radius}
                    fill={isSelected ? mapPalette.markerFill : mapPalette.markerFillInactive}
                    stroke={isSelected ? mapPalette.markerSelectedStroke : mapPalette.markerStroke}
                    strokeWidth={isSelected ? 1.5 : 1}
                  />
                </g>
              );
            })}
        </g>
      </svg>

      <div
        className="pointer-events-none absolute bottom-3 left-3 rounded-xl border px-3 py-2 text-[11px] backdrop-blur"
        style={{
          borderColor: mapPalette.panelBorder,
          backgroundColor: mapPalette.panelBackground,
          color: mapPalette.panelText,
        }}
      >
        <div className="mb-1 uppercase tracking-[0.2em]" style={{ color: theme.foregroundSecondary }}>Heat Scale</div>
        <div
          className="mb-2 h-2 w-36 rounded-full"
          style={{
            background: `linear-gradient(90deg, ${withAlpha(theme.accent, theme.isDark ? 0.12 : 0.16)}, ${withAlpha(theme.accent, theme.isDark ? 0.72 : 0.56)})`,
          }}
        />
        <div className="flex justify-between">
          <span>{Math.round(mapLegend.min)}</span>
          <span>{Math.round(mapLegend.max)}</span>
        </div>
      </div>

      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 min-w-[180px] rounded-xl border px-3 py-2 text-xs shadow-xl backdrop-blur"
          style={{
            borderColor: mapPalette.panelBorder,
            backgroundColor: mapPalette.panelBackground,
            color: theme.foreground,
            left: Math.max(12, Math.min(tooltip.x + 14, VIEWBOX_WIDTH - 220)),
            top: Math.max(52, Math.min(tooltip.y + 14, VIEWBOX_HEIGHT - 92)),
          }}
        >
          <div className="font-semibold">{tooltip.title}</div>
          <div className="mt-1" style={{ color: theme.foregroundSecondary }}>{tooltip.meta}</div>
          <div className="mt-1" style={{ color: withAlpha(theme.foregroundSecondary, 0.86) }}>{tooltip.detail}</div>
        </div>
      )}
    </div>
  );
}
