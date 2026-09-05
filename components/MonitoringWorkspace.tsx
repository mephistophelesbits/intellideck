'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS as DndCss } from '@dnd-kit/utilities';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Database,
  ExternalLink,
  GripVertical,
  PencilLine,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { AppChrome } from '@/components/AppChrome';
import { ArticlePreviewPanel } from '@/components/ui/ArticlePreviewPanel';
import { TimeAgo } from '@/components/ui/TimeAgo';
import { useTranslation } from '@/lib/i18n';
import { Article } from '@/lib/types';
import { decodeHtml } from '@/lib/utils';

type SearchRuleSettings = {
  matchMode: 'or' | 'and';
  excludeKeywords: string[];
};

type SearchResult = {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  contentSnippet: string | null;
  rawContent: string | null;
  category: string | null;
  importanceScore: number;
  matchedTerms: string[];
  relevance: number;
  escalationCount24h: number;
  isEscalating: boolean;
};

type MonitoringHighlight = {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  sourceTitle: string | null;
  relevance: number;
  importanceScore: number;
  matchedTerms: string[];
};

type MonitoringGroup = {
  ruleId: string;
  ruleName: string;
  ruleColor: string;
  query: string;
  keywords: string[];
  settings: SearchRuleSettings;
  articleCount: number;
  feedCount: number;
  latestPublishedAt: string | null;
  averageRelevance: number;
  sentimentScore: number;
  sentimentLabel: 'positive' | 'neutral' | 'negative';
  escalatingCount: number;
  breakingHighlights: MonitoringHighlight[];
};

type MonitoringResponse = {
  groups: MonitoringGroup[];
  meta: {
    days: number;
    totalGroups: number;
    updatedAt: string;
  };
};

type SearchResponse = {
  keywords: string[];
  results: SearchResult[];
};

type SearchRuleSaveSummary = {
  id: string;
  name: string;
  ruleColor: string;
  query: string;
  settings: SearchRuleSettings;
};

type SaveSearchRuleResponse = {
  savedRule: SearchRuleSaveSummary;
  rules: SearchRuleSaveSummary[];
};

type SortableSavedRuleCardProps = {
  group: MonitoringGroup;
  isSelected: boolean;
  onSelect: (group: MonitoringGroup) => void | Promise<void>;
  onEdit: (group: MonitoringGroup) => void;
  onDelete: (ruleId: string) => void | Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const DATE_WINDOWS = [1, 3, 7, 30];
const LIVE_REFRESH_MS = 30_000;
const SEARCH_TERM_SPLIT_PATTERN = /[,\n;，；]+/;
const DEFAULT_RULE_COLOR = '#f97316';
const RULE_COLOR_PRESETS = [
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
];

const DEFAULT_SEARCH_SETTINGS: SearchRuleSettings = {
  matchMode: 'or',
  excludeKeywords: [],
};

function normalizeRuleColor(value?: string | null) {
  const normalized = value?.trim().toLowerCase() ?? '';
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : DEFAULT_RULE_COLOR;
}

function SortableSavedRuleCard({
  group,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
  t,
}: SortableSavedRuleCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.ruleId });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: DndCss.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      className={`rounded-2xl border p-4 transition-colors ${
        isSelected
          ? 'border-accent bg-accent/10'
          : 'border-border bg-background hover:border-foreground-secondary/30'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <button
            type="button"
            className="drag-handle mt-0.5 rounded-md p-1 text-foreground-secondary transition-colors hover:bg-background-tertiary hover:text-foreground"
            aria-label={t('monitoring.reorderSearch')}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => void onSelect(group)}
            className="min-w-0 flex-1 text-left"
          >
            <div
              className="truncate text-base font-bold"
              style={{ color: normalizeRuleColor(group.ruleColor) }}
            >
              {group.ruleName}
            </div>
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onEdit(group)}
            className="rounded-md p-1 text-foreground-secondary transition-colors hover:bg-background-tertiary hover:text-accent"
            aria-label={t('monitoring.editSearch')}
          >
            <PencilLine className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void onDelete(group.ruleId)}
            className="rounded-md p-1 text-foreground-secondary transition-colors hover:bg-background-tertiary hover:text-red-400"
            aria-label={`Delete ${group.ruleName}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`Empty response (${response.status})`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid response payload (${response.status})`);
  }
}

function mapSearchResultToArticle(result: SearchResult): Article {
  return {
    id: result.id,
    title: result.title,
    link: result.url,
    pubDate: result.publishedAt || new Date().toISOString(),
    contentSnippet: result.contentSnippet || undefined,
    content: result.rawContent || undefined,
    sourceTitle: result.sourceTitle || undefined,
    sourceUrl: result.sourceUrl || undefined,
  };
}

function getSearchResultTime(result: SearchResult) {
  return new Date(result.publishedAt || 0).getTime();
}

function sortSearchResults(results: SearchResult[], sortOrder: 'newest' | 'oldest' | 'escalating') {
  return [...results].sort((left, right) => {
    if (sortOrder === 'escalating') {
      return (
        right.escalationCount24h - left.escalationCount24h
        || Number(right.isEscalating) - Number(left.isEscalating)
        || getSearchResultTime(right) - getSearchResultTime(left)
      );
    }

    if (sortOrder === 'oldest') {
      return getSearchResultTime(left) - getSearchResultTime(right);
    }

    return getSearchResultTime(right) - getSearchResultTime(left);
  });
}

function normalizeKeywordQuery(value: string) {
  return Array.from(
    new Set(
      value
        .split(SEARCH_TERM_SPLIT_PATTERN)
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean)
    )
  ).join(', ');
}

function parseKeywordList(value: string) {
  return Array.from(
    new Set(
      value
        .split(SEARCH_TERM_SPLIT_PATTERN)
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function normalizeExcludeKeywords(value: string) {
  return Array.from(
    new Set(
      value
        .split(SEARCH_TERM_SPLIT_PATTERN)
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function normalizeSearchSettings(settings?: Partial<SearchRuleSettings> | null): SearchRuleSettings {
  return {
    matchMode: settings?.matchMode === 'and' ? 'and' : 'or',
    excludeKeywords: normalizeExcludeKeywords((settings?.excludeKeywords ?? []).join(', ')),
  };
}

function settingsSignature(settings?: Partial<SearchRuleSettings> | null) {
  const normalized = normalizeSearchSettings(settings);
  return `${normalized.matchMode}:${normalized.excludeKeywords.join('|')}`;
}

export function MonitoringWorkspace() {
  const { t } = useTranslation();
  const [days, setDays] = useState(7);
  const [data, setData] = useState<MonitoringResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeQuery, setActiveQuery] = useState('');
  const [ruleName, setRuleName] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [searchSettings, setSearchSettings] = useState<SearchRuleSettings>(DEFAULT_SEARCH_SETTINGS);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [draftQuery, setDraftQuery] = useState('');
  const [draftRuleName, setDraftRuleName] = useState('');
  const [draftRuleColor, setDraftRuleColor] = useState(DEFAULT_RULE_COLOR);
  const [draftSearchSettings, setDraftSearchSettings] = useState<SearchRuleSettings>(DEFAULT_SEARCH_SETTINGS);
  const [draftExcludeKeywords, setDraftExcludeKeywords] = useState('');
  const [searchModalError, setSearchModalError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingResults, setIsSavingResults] = useState(false);
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'escalating'>('newest');
  const monitoringRequestIdRef = useRef(0);
  const searchRequestIdRef = useRef(0);
  const ruleNameInputRef = useRef<HTMLInputElement | null>(null);
  const queryInputRef = useRef<HTMLTextAreaElement | null>(null);
  const excludeKeywordsInputRef = useRef<HTMLInputElement | null>(null);

  const groups = useMemo(() => data?.groups ?? [], [data?.groups]);
  const selectedGroup = groups.find((group) => group.ruleId === selectedGroupId) ?? null;
  const ruleSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sortedResults = useMemo(() => {
    return sortSearchResults(results, sortOrder);
  }, [results, sortOrder]);

  const breakingHighlightIds = useMemo(
    () => new Set(selectedGroup?.breakingHighlights.map((item) => item.id) ?? []),
    [selectedGroup],
  );

  const selectArticleAtIndex = useCallback((index: number) => {
    const target = sortedResults[index];
    if (!target) return;
    setSelectedArticle(mapSearchResultToArticle(target));
  }, [sortedResults]);

  const selectAdjacentArticle = useCallback((direction: 'previous' | 'next') => {
    if (sortedResults.length === 0) return;

    const currentIndex = selectedArticle
      ? sortedResults.findIndex((result) => result.id === selectedArticle.id)
      : -1;

    if (currentIndex === -1) {
      selectArticleAtIndex(direction === 'next' ? 0 : sortedResults.length - 1);
      return;
    }

    const nextIndex = direction === 'next'
      ? Math.min(currentIndex + 1, sortedResults.length - 1)
      : Math.max(currentIndex - 1, 0);

    if (nextIndex !== currentIndex) {
      selectArticleAtIndex(nextIndex);
    }
  }, [selectArticleAtIndex, selectedArticle, sortedResults]);

  const findMatchingGroup = useCallback((
    nextQuery: string,
    nextSettings: SearchRuleSettings,
    sourceGroups = groups,
  ) => {
    const normalizedQuery = normalizeKeywordQuery(nextQuery);
    const normalizedSettings = settingsSignature(nextSettings);
    return sourceGroups.find((group) => (
      normalizeKeywordQuery(group.query) === normalizedQuery
      && settingsSignature(group.settings) === normalizedSettings
    )) ?? null;
  }, [groups]);

  const applyActiveSearchFromGroup = useCallback((group: MonitoringGroup) => {
    setRuleName(group.ruleName);
    setSearchSettings(normalizeSearchSettings(group.settings));
  }, []);

  const openSearchModal = useCallback((group?: MonitoringGroup | null) => {
    setEditingRuleId(group?.ruleId ?? null);
    setDraftRuleName(group?.ruleName ?? '');
    setDraftRuleColor(normalizeRuleColor(group?.ruleColor));
    setDraftQuery(group?.query ?? '');
    setDraftSearchSettings(normalizeSearchSettings(group?.settings ?? DEFAULT_SEARCH_SETTINGS));
    setDraftExcludeKeywords((group?.settings?.excludeKeywords ?? []).join(', '));
    setSearchModalError(null);
    setIsSearchModalOpen(true);
  }, []);

  const closeSearchModal = useCallback(() => {
    setIsSearchModalOpen(false);
    setSearchModalError(null);
  }, []);

  const readDraftSnapshot = useCallback(() => {
    const nextRuleName = ruleNameInputRef.current?.value ?? draftRuleName;
    const nextQuery = queryInputRef.current?.value ?? draftQuery;
    const nextExcludeKeywordsRaw = excludeKeywordsInputRef.current?.value ?? draftExcludeKeywords;
    const nextSettings = {
      ...draftSearchSettings,
      excludeKeywords: normalizeExcludeKeywords(nextExcludeKeywordsRaw),
    };

    return {
      ruleName: nextRuleName,
      ruleColor: normalizeRuleColor(draftRuleColor),
      query: nextQuery,
      settings: nextSettings,
    };
  }, [draftExcludeKeywords, draftQuery, draftRuleColor, draftRuleName, draftSearchSettings]);

  const syncMonitoringGroups = useCallback((
    current: MonitoringResponse | null,
    rules: SearchRuleSaveSummary[],
  ) => {
    if (!current) return current;

    const existingGroups = new Map(current.groups.map((group) => [group.ruleId, group]));
    return {
      ...current,
      groups: rules.map((rule) => {
        const existing = existingGroups.get(rule.id);
        const settings = normalizeSearchSettings(rule.settings);
        const keywords = parseKeywordList(rule.query);

        if (existing) {
          return {
            ...existing,
            ruleName: rule.name,
            ruleColor: normalizeRuleColor(rule.ruleColor),
            query: rule.query,
            keywords,
            settings,
          };
        }

        return {
          ruleId: rule.id,
          ruleName: rule.name,
          ruleColor: normalizeRuleColor(rule.ruleColor),
          query: rule.query,
          keywords,
          settings,
          articleCount: 0,
          feedCount: 0,
          latestPublishedAt: null,
          averageRelevance: 0,
          sentimentScore: 0,
          sentimentLabel: 'neutral' as const,
          escalatingCount: 0,
          breakingHighlights: [],
        };
      }),
    };
  }, []);

  const runSearchQuery = useCallback(async (
    queryToRun: string,
    options?: {
      nextDays?: number;
      nextSettings?: SearchRuleSettings;
      nextSelectedGroupId?: string | null;
      nextRuleName?: string;
      nextEditingRuleId?: string | null;
      preferTopResult?: boolean;
    },
  ) => {
    const trimmedQuery = queryToRun.trim();
    const nextSettings = normalizeSearchSettings(options?.nextSettings ?? searchSettings);

    if (!trimmedQuery) {
      setWorkspaceMessage(t('search.enterKeywords'));
      return;
    }

    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setIsSearching(true);
    setWorkspaceMessage(null);

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: trimmedQuery,
          days: options?.nextDays ?? days,
          ruleId: options?.nextEditingRuleId ?? undefined,
          settings: nextSettings,
        }),
      });
      const payload = await parseJsonResponse<SearchResponse & { error?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.error || 'Search failed');
      }

      if (requestId !== searchRequestIdRef.current) {
        return;
      }

      const matchedGroup = findMatchingGroup(trimmedQuery, nextSettings);
      const nextSelectedGroupId = options?.nextSelectedGroupId === undefined
        ? matchedGroup?.ruleId ?? null
        : options.nextSelectedGroupId;
      const nextRuleName = options?.nextRuleName ?? matchedGroup?.ruleName ?? '';
      const sortedPayloadResults = sortSearchResults(payload.results ?? [], sortOrder);

      setActiveQuery(trimmedQuery);
      setSearchSettings(nextSettings);
      setResults(payload.results ?? []);
      setSelectedArticle((currentArticle) => {
        if (!sortedPayloadResults.length) return null;
        if (options?.preferTopResult) {
          return mapSearchResultToArticle(sortedPayloadResults[0]);
        }
        if (currentArticle) {
          const matchingResult = sortedPayloadResults.find((result) => result.id === currentArticle.id);
          if (matchingResult) {
            return mapSearchResultToArticle(matchingResult);
          }
        }
        return mapSearchResultToArticle(sortedPayloadResults[0]);
      });
      setSelectedGroupId(nextSelectedGroupId);
      if (nextRuleName) {
        setRuleName(nextRuleName);
      }
    } catch (runError) {
      if (requestId === searchRequestIdRef.current) {
        setWorkspaceMessage(runError instanceof Error ? runError.message : 'Search failed');
      }
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setIsSearching(false);
      }
    }
  }, [days, findMatchingGroup, searchSettings, sortOrder, t]);

  const loadMonitoring = useCallback(async (
    nextDays = days,
    options?: { preferredRuleId?: string | null; reloadActiveQuery?: boolean },
  ) => {
    const requestId = monitoringRequestIdRef.current + 1;
    monitoringRequestIdRef.current = requestId;
    setLoading(true);
    try {
      const response = await fetch(`/api/monitoring?days=${nextDays}`, { cache: 'no-store' });
      const payload = await parseJsonResponse<MonitoringResponse & { error?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load monitoring');
      }

      if (requestId !== monitoringRequestIdRef.current) {
        return;
      }

      setData(payload);
      setError(null);

      const nextGroup =
        (options?.preferredRuleId ? payload.groups.find((group) => group.ruleId === options.preferredRuleId) : null)
        ?? (selectedGroupId ? payload.groups.find((group) => group.ruleId === selectedGroupId) : null)
        ?? (!activeQuery.trim() ? payload.groups[0] ?? null : null);

      if (nextGroup) {
        const shouldReload =
          Boolean(options?.reloadActiveQuery)
          || nextGroup.ruleId !== selectedGroupId
          || results.length === 0
          || normalizeKeywordQuery(activeQuery) !== normalizeKeywordQuery(nextGroup.query)
          || settingsSignature(searchSettings) !== settingsSignature(nextGroup.settings);

        setSelectedGroupId(nextGroup.ruleId);
        applyActiveSearchFromGroup(nextGroup);

        if (shouldReload) {
          await runSearchQuery(nextGroup.query, {
            nextDays,
            nextSettings: nextGroup.settings,
            nextSelectedGroupId: nextGroup.ruleId,
            nextRuleName: nextGroup.ruleName,
            nextEditingRuleId: nextGroup.ruleId,
          });
        }
      } else if (options?.reloadActiveQuery && activeQuery.trim()) {
        await runSearchQuery(activeQuery, {
          nextDays,
          nextSettings: searchSettings,
          nextSelectedGroupId: null,
          nextRuleName: ruleName,
          nextEditingRuleId: editingRuleId,
        });
      } else if (payload.groups.length === 0 && !activeQuery.trim()) {
        setSelectedGroupId(null);
        setResults([]);
        setSelectedArticle(null);
      }
    } catch (loadError) {
      if (requestId === monitoringRequestIdRef.current) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load monitoring');
      }
    } finally {
      if (requestId === monitoringRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [
    activeQuery,
    applyActiveSearchFromGroup,
    days,
    editingRuleId,
    results.length,
    ruleName,
    runSearchQuery,
    searchSettings,
    selectedGroupId,
  ]);

  useEffect(() => {
    void loadMonitoring(days, { reloadActiveQuery: true });
  }, [days]);

  useEffect(() => {
    if ((!selectedGroupId && !activeQuery.trim()) || isSearchModalOpen) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      void loadMonitoring(days, { reloadActiveQuery: true });
    }, LIVE_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [activeQuery, days, isSearchModalOpen, loadMonitoring, selectedGroupId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isSearchModalOpen) return;

      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || Boolean(target?.closest('[contenteditable="true"]'))
      ) {
        return;
      }

      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        selectAdjacentArticle('next');
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        selectAdjacentArticle('previous');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchModalOpen, selectAdjacentArticle]);

  useEffect(() => {
    if (!selectedArticle) return;

    const escapeSelector = globalThis.CSS?.escape ?? ((value: string) => value.replace(/["\\]/g, '\\$&'));
    const row = document.querySelector<HTMLElement>(`[data-article-id="${escapeSelector(selectedArticle.id)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedArticle]);

  const handleSelectGroup = async (group: MonitoringGroup) => {
    setSelectedGroupId(group.ruleId);
    setEditingRuleId(null);
    applyActiveSearchFromGroup(group);
    await runSearchQuery(group.query, {
      nextDays: days,
      nextSettings: group.settings,
      nextSelectedGroupId: group.ruleId,
      nextRuleName: group.ruleName,
      nextEditingRuleId: group.ruleId,
      preferTopResult: true,
    });
  };

  const handleRunModalSearch = async () => {
    const draftSnapshot = readDraftSnapshot();
    const trimmedQuery = draftSnapshot.query.trim();
    if (!trimmedQuery) {
      setSearchModalError(t('search.enterKeywords'));
      return;
    }

    setDraftRuleName(draftSnapshot.ruleName);
    setDraftQuery(draftSnapshot.query);
    setDraftSearchSettings(draftSnapshot.settings);
    const matchedGroup = findMatchingGroup(trimmedQuery, draftSnapshot.settings);
    closeSearchModal();
    await runSearchQuery(trimmedQuery, {
      nextDays: days,
      nextSettings: draftSnapshot.settings,
      nextSelectedGroupId: matchedGroup?.ruleId ?? null,
      nextRuleName: draftSnapshot.ruleName.trim() || matchedGroup?.ruleName || t('monitoring.newSearch'),
      nextEditingRuleId: editingRuleId,
    });
  };

  const handleSaveRule = useCallback(async () => {
    const draftSnapshot = readDraftSnapshot();
    const trimmedQuery = draftSnapshot.query.trim();
    if (!trimmedQuery) {
      setSearchModalError(t('search.runBeforeSaving'));
      return;
    }
    const normalizedQuery = normalizeKeywordQuery(trimmedQuery);

    setIsSaving(true);
    setSearchModalError(null);
    setWorkspaceMessage(null);

    try {
      const response = await fetch('/api/search/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingRuleId ?? undefined,
          name: draftSnapshot.ruleName.trim() || undefined,
          ruleColor: draftSnapshot.ruleColor,
          query: normalizedQuery,
          settings: draftSnapshot.settings,
        }),
      });
      const payload = await parseJsonResponse<SaveSearchRuleResponse & { error?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to save search');
      }

      const savedRule = payload.savedRule;
      setData((current) => syncMonitoringGroups(current, payload.rules));
      setSelectedGroupId(savedRule.id);
      setEditingRuleId(null);
      setDraftQuery(savedRule.query);
      setDraftRuleName(savedRule.name);
      setDraftRuleColor(normalizeRuleColor(savedRule.ruleColor));
      setDraftSearchSettings(savedRule.settings);
      setDraftExcludeKeywords(savedRule.settings.excludeKeywords.join(', '));
      setRuleName(savedRule.name);
      setActiveQuery(savedRule.query);
      setSearchSettings(savedRule.settings);
      closeSearchModal();
      await runSearchQuery(savedRule.query, {
        nextDays: days,
        nextSettings: savedRule.settings,
        nextSelectedGroupId: savedRule.id,
        nextRuleName: savedRule.name,
        nextEditingRuleId: savedRule.id,
        preferTopResult: true,
      });
      await loadMonitoring(days, {
        preferredRuleId: savedRule.id,
        reloadActiveQuery: true,
      });
      setWorkspaceMessage(t('search.searchRuleSaved'));
    } catch (saveError) {
      setSearchModalError(saveError instanceof Error ? saveError.message : 'Failed to save search');
    } finally {
      setIsSaving(false);
    }
  }, [closeSearchModal, days, editingRuleId, loadMonitoring, readDraftSnapshot, runSearchQuery, syncMonitoringGroups, t]);

  const handleDeleteRule = async (ruleId: string) => {
    const response = await fetch(`/api/search/rules?ruleId=${encodeURIComponent(ruleId)}`, {
      method: 'DELETE',
    });
    const payload = await parseJsonResponse<{ error?: string }>(response);
    if (!response.ok) {
      setWorkspaceMessage(payload.error || 'Failed to delete search rule');
      return;
    }

    const deletingSelectedRule = selectedGroupId === ruleId;
    const deletingEditingRule = editingRuleId === ruleId;

    if (deletingSelectedRule) {
      setSelectedGroupId(null);
    }

    if (deletingEditingRule) {
      setEditingRuleId(null);
      closeSearchModal();
    }

    await loadMonitoring(days, {
      reloadActiveQuery: !deletingSelectedRule && !deletingEditingRule,
    });
  };

  const handleRuleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !data) {
      return;
    }

    const oldIndex = groups.findIndex((group) => group.ruleId === active.id);
    const newIndex = groups.findIndex((group) => group.ruleId === over.id);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    const reorderedGroups = arrayMove(groups, oldIndex, newIndex);
    const previousData = data;
    setData({
      ...data,
      groups: reorderedGroups,
    });

    try {
      const response = await fetch('/api/search/rules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ruleIds: reorderedGroups.map((group) => group.ruleId),
        }),
      });
      const payload = await parseJsonResponse<Array<{ id: string }> & { error?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to reorder saved searches');
      }
      await loadMonitoring(days, { preferredRuleId: selectedGroupId });
    } catch (reorderError) {
      setData(previousData);
      setWorkspaceMessage(reorderError instanceof Error ? reorderError.message : 'Failed to reorder saved searches');
    }
  };

  const handleRefreshAll = async () => {
    const response = await fetch('/api/intelligence/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const payload = await parseJsonResponse<{ error?: string }>(response);
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to refresh saved feeds');
    }

    await loadMonitoring(days, { reloadActiveQuery: true });
  };

  const handleSaveResults = async () => {
    if (!selectedGroupId || results.length === 0) {
      setWorkspaceMessage(t('search.noResultsToSave'));
      return;
    }

    setIsSavingResults(true);
    setWorkspaceMessage(null);

    try {
      const response = await fetch('/api/search/save-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          searchRuleId: selectedGroupId,
          results,
        }),
      });
      const payload = await parseJsonResponse<{ count?: number; error?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to save results');
      }

      setWorkspaceMessage(t('search.resultsSavedCount', { count: payload.count ?? 0 }));
    } catch (saveError) {
      setWorkspaceMessage(saveError instanceof Error ? saveError.message : 'Failed to save results');
    } finally {
      setIsSavingResults(false);
    }
  };

  return (
    <AppChrome onRefreshAll={handleRefreshAll} showAddFeedAction={false}>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="border-b border-border bg-background-secondary/40 px-6 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-[220px]">
              <h1 className="text-lg font-semibold">{t('monitoring.title')}</h1>
              <p className="text-sm text-foreground-secondary">{t('monitoring.description')}</p>
              {data?.meta.updatedAt && (
                <p className="mt-2 text-xs text-foreground-secondary/70">
                  {t('monitoring.updated')} <TimeAgo date={data.meta.updatedAt} />
                </p>
              )}
            </div>

            <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => openSearchModal(null)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-[color:var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Search className="h-4 w-4" />
                {t('monitoring.newSearch')}
              </button>

              <label className="flex items-center gap-2 text-sm text-foreground-secondary">
                <span>{t('monitoring.window')}</span>
                <div className="relative">
                  <select
                    value={days}
                    onChange={(event) => setDays(Number(event.target.value))}
                    className="appearance-none rounded-lg border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground focus:border-accent focus:outline-none"
                  >
                    {DATE_WINDOWS.map((value) => (
                      <option key={value} value={value}>{t('monitoring.lastDays', { count: value })}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-secondary" />
                </div>
              </label>
            </div>
          </div>
        </div>

        {error && <p className="px-6 py-3 text-sm text-red-400">{error}</p>}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="w-[300px] shrink-0 border-r border-border bg-background-secondary/70 p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-[0.22em] text-foreground-secondary">
                {t('search.savedRules')}
              </div>
              <div className="text-xs text-foreground-secondary">{groups.length}</div>
            </div>

            <div className="mt-4 overflow-y-auto pr-1" style={{ maxHeight: 'calc(100vh - 250px)' }}>
              {loading && groups.length === 0 ? (
                <div className="rounded-xl border border-border bg-background p-4 text-sm text-foreground-secondary">
                  {t('monitoring.loading')}
                </div>
              ) : groups.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-4 text-sm text-foreground-secondary">
                  {t('monitoring.emptyBody')}
                </div>
              ) : (
                <DndContext sensors={ruleSensors} collisionDetection={closestCenter} onDragEnd={handleRuleDragEnd}>
                  <SortableContext items={groups.map((group) => group.ruleId)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-3">
                      {groups.map((group) => (
                        <SortableSavedRuleCard
                          key={group.ruleId}
                          group={group}
                          isSelected={selectedGroupId === group.ruleId}
                          onSelect={handleSelectGroup}
                          onEdit={openSearchModal}
                          onDelete={handleDeleteRule}
                          t={t}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 overflow-hidden">
            <div className="flex min-w-0 flex-1 flex-col border-r border-border xl:w-[46%] xl:flex-none">
              <header className="border-b border-border bg-background-secondary px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold">
                      {selectedGroup?.ruleName || ruleName || t('search.articleSearch')}
                    </h2>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <label className="text-xs font-medium text-foreground-secondary">{t('search.sortBy')}:</label>
                    <select
                      value={sortOrder}
                      onChange={(event) => setSortOrder(event.target.value as 'newest' | 'oldest' | 'escalating')}
                      className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:border-accent focus:outline-none"
                    >
                      <option value="escalating">{t('search.sortEscalating')}</option>
                      <option value="newest">{t('search.sortNewest')}</option>
                      <option value="oldest">{t('search.sortOldest')}</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleSaveResults()}
                      disabled={isSavingResults || !selectedGroupId || results.length === 0}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-foreground-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                      title={t('search.saveResultsToDatabase')}
                    >
                      <Database className="h-3.5 w-3.5" />
                      {isSavingResults ? t('search.saving') : t('search.saveResults')}
                    </button>
                  </div>
                </div>

                {workspaceMessage && (
                  <div className="mt-3 text-sm text-foreground-secondary">{workspaceMessage}</div>
                )}
              </header>

              <div className="flex-1 overflow-y-auto">
                {results.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center px-6 text-center text-foreground-secondary">
                    <Database className="mb-4 h-10 w-10 opacity-40" />
                    <p className="text-base font-medium text-foreground">{t('search.emptyTitle')}</p>
                    <p className="mt-2 max-w-lg text-sm">{t('search.emptyDesc')}</p>
                  </div>
                ) : (
                  <>
                    <div className="divide-y divide-border">
                      {sortedResults.map((result, index) => {
                        const isBreaking = breakingHighlightIds.has(result.id);
                        const isEscalating = result.isEscalating;

                        return (
                          <button
                            key={result.id}
                            type="button"
                            data-article-id={result.id}
                            onClick={() => setSelectedArticle(mapSearchResultToArticle(result))}
                            className={`block w-full p-4 text-left transition-colors hover:bg-background-secondary ${
                              selectedArticle?.id === result.id
                                ? 'bg-accent/10'
                                : isBreaking
                                  ? 'bg-amber-500/5'
                                  : ''
                            }`}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 text-xs text-foreground-secondary">
                                  <span className="rounded-full border border-border px-2 py-0.5">{index + 1}</span>
                                  {isBreaking && (
                                    <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-amber-300">
                                      {t('monitoring.breaking')}
                                    </span>
                                  )}
                                  {isEscalating && (
                                    <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-cyan-300">
                                      {t('monitoring.escalating')} ×{result.escalationCount24h}
                                    </span>
                                  )}
                                  {result.category && <span>{result.category}</span>}
                                  {result.sourceTitle && <span className="truncate">{decodeHtml(result.sourceTitle)}</span>}
                                  {result.publishedAt && <TimeAgo date={result.publishedAt} />}
                                </div>
                                <h3 className="mt-2 line-clamp-2 text-base font-semibold text-foreground">
                                  {decodeHtml(result.title)}
                                </h3>
                                {result.contentSnippet && (
                                  <p className="mt-2 line-clamp-2 text-sm text-foreground-secondary">
                                    {decodeHtml(result.contentSnippet)}
                                  </p>
                                )}
                              </div>

                              <div className="shrink-0 text-right">
                                <a
                                  href={result.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(event) => event.stopPropagation()}
                                  className="mt-3 inline-flex rounded-lg border border-border p-2 text-foreground-secondary transition-colors hover:border-accent hover:text-accent"
                                  title={t('search.openOriginal')}
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="hidden xl:block xl:min-w-[560px] xl:flex-1">
              <ArticlePreviewPanel article={selectedArticle} onClose={() => setSelectedArticle(null)} />
            </div>
          </div>
        </div>

        {isSearchModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={closeSearchModal}
            />

            <div className="relative mx-4 flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background-secondary shadow-2xl">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold">
                    {editingRuleId ? t('monitoring.editSearch') : t('monitoring.newSearch')}
                  </h2>
                  <p className="mt-1 text-sm text-foreground-secondary">{t('monitoring.searchSettings')}</p>
                </div>
                <button
                  type="button"
                  onClick={closeSearchModal}
                  className="rounded-lg p-2 text-foreground-secondary transition-colors hover:bg-background-tertiary hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4 px-5 py-5">
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">
                    {t('search.ruleNamePlaceholder')}
                  </div>
                  <input
                    ref={ruleNameInputRef}
                    type="text"
                    value={draftRuleName}
                    onChange={(event) => setDraftRuleName(event.target.value)}
                    placeholder={t('search.ruleNamePlaceholder')}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                </div>

                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">
                    {t('monitoring.ruleColor')}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-3">
                    <input
                      type="color"
                      value={normalizeRuleColor(draftRuleColor)}
                      onChange={(event) => setDraftRuleColor(normalizeRuleColor(event.target.value))}
                      aria-label={t('monitoring.ruleColor')}
                      className="h-10 w-10 cursor-pointer rounded-md border border-border bg-transparent"
                    />
                    <div className="flex flex-wrap gap-2">
                      {RULE_COLOR_PRESETS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setDraftRuleColor(color)}
                          className={`h-6 w-6 rounded-full border transition-transform hover:scale-105 ${
                            normalizeRuleColor(draftRuleColor) === color ? 'border-white' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: color }}
                          aria-label={`${t('monitoring.ruleColor')} ${color}`}
                        />
                      ))}
                    </div>
                    <div
                      className="truncate text-sm font-bold"
                      style={{ color: normalizeRuleColor(draftRuleColor) }}
                    >
                      {draftRuleName.trim() || t('monitoring.ruleColorPreview')}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">
                    {t('monitoring.newSearch')}
                  </div>
                  <textarea
                    ref={queryInputRef}
                    value={draftQuery}
                    onChange={(event) => setDraftQuery(event.target.value)}
                    placeholder={t('search.keywordsPlaceholder')}
                    className="min-h-[100px] w-full rounded-lg border border-border bg-background px-3 py-3 text-sm focus:border-accent focus:outline-none"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-[220px_minmax(260px,1fr)]">
                  <div>
                    <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">
                      {t('monitoring.matchMode')}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setDraftSearchSettings((current) => ({ ...current, matchMode: 'or' }))}
                        className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                          draftSearchSettings.matchMode === 'or'
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-border bg-background text-foreground-secondary hover:border-accent hover:text-accent'
                        }`}
                      >
                        {t('monitoring.matchAny')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDraftSearchSettings((current) => ({ ...current, matchMode: 'and' }))}
                        className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                          draftSearchSettings.matchMode === 'and'
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-border bg-background text-foreground-secondary hover:border-accent hover:text-accent'
                        }`}
                      >
                        {t('monitoring.matchAll')}
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">
                      {t('monitoring.excludeKeywords')}
                    </div>
                    <input
                      ref={excludeKeywordsInputRef}
                      type="text"
                      value={draftExcludeKeywords}
                      onChange={(event) => setDraftExcludeKeywords(event.target.value)}
                      placeholder={t('monitoring.excludePlaceholder')}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>

                {searchModalError && (
                  <div className="text-sm text-red-400">{searchModalError}</div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
                <button
                  type="button"
                  onClick={closeSearchModal}
                  className="rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground-secondary transition-colors hover:border-accent hover:text-accent"
                >
                  {t('common.cancel')}
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleRunModalSearch()}
                    disabled={isSearching}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSearching ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    {t('monitoring.newSearch')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveRule()}
                    disabled={isSaving}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[color:var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Save className="h-4 w-4" />
                    {isSaving ? t('search.saving') : t('search.saveSearch')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppChrome>
  );
}
