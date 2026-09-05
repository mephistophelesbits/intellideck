import 'server-only';

import crypto from 'crypto';
import { getDb } from './db';
import { BREAKING_TERMS, TERM_SPLIT_PATTERN as SEARCH_TERM_SPLIT_PATTERN, toLikeParam } from './search-terms';

export type SavedSearchRule = {
  id: string;
  name: string;
  ruleColor: string;
  query: string;
  keywords: string[];
  settings: SearchRuleSettings;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
};

export type SearchRuleSettings = {
  matchMode: 'or' | 'and';
  excludeKeywords: string[];
};

export type SearchRuleSaveSummary = {
  id: string;
  name: string;
  ruleColor: string;
  query: string;
  settings: SearchRuleSettings;
};

export type SearchResult = {
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

export type MonitoringHighlight = {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  sourceTitle: string | null;
  relevance: number;
  importanceScore: number;
  matchedTerms: string[];
};

export type MonitoringGroup = {
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

type SearchRow = {
  id: string;
  title: string;
  canonical_url: string;
  published_at: string | null;
  created_at: string;
  source_title: string | null;
  source_url: string | null;
  content_snippet: string | null;
  raw_content: string | null;
  primary_category: string | null;
  importance_score: number | null;
  relevance: number;
};

type SearchQueryParts = {
  whereClause: string;
  whereParams: string[];
  scoreExpression: string;
  scoreParams: string[];
  mode: 'full' | 'lite';
};

const DEFAULT_SEARCH_RULE_SETTINGS: SearchRuleSettings = {
  matchMode: 'or',
  excludeKeywords: [],
};

const POSITIVE_TERMS = [
  'surge', 'growth', 'record', 'breakthrough', 'win', 'profit', 'launch', 'partnership', 'expands', 'beats',
  '上涨', '增长', '突破', '合作', '盈利', '创纪录', '推出',
];
const NEGATIVE_TERMS = [
  'drop', 'fall', 'loss', 'cut', 'layoff', 'crisis', 'warning', 'probe', 'lawsuit', 'breach', 'tariff',
  '下跌', '亏损', '裁员', '危机', '调查', '诉讼', '警告', '关税',
];
const ESCALATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const LITE_SEARCH_KEYWORD_THRESHOLD = 16;
export const DEFAULT_SEARCH_RULE_COLOR = '#f97316';

function normalizeSearchRuleColor(value?: string | null) {
  const normalized = value?.trim().toLowerCase() ?? '';
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : DEFAULT_SEARCH_RULE_COLOR;
}

function safeParseStringArray(value: string | null | undefined, fallback: string[] = []) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : fallback;
  } catch {
    return fallback;
  }
}

function safeParseSearchRuleSettings(value: string | null | undefined) {
  if (!value) return DEFAULT_SEARCH_RULE_SETTINGS;
  try {
    return normalizeSearchRuleSettings(JSON.parse(value) as Partial<SearchRuleSettings>);
  } catch {
    return DEFAULT_SEARCH_RULE_SETTINGS;
  }
}

export function parseSearchKeywords(query: string) {
  return Array.from(
    new Set(
      query
        .split(SEARCH_TERM_SPLIT_PATTERN)
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function normalizeSearchRuleSettings(settings?: Partial<SearchRuleSettings> | null): SearchRuleSettings {
  const matchMode = settings?.matchMode === 'and' ? 'and' : 'or';
  const excludeKeywords = Array.from(
    new Set(
      (settings?.excludeKeywords ?? [])
        .flatMap((value) => value.split(SEARCH_TERM_SPLIT_PATTERN))
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean)
    )
  );

  return {
    matchMode,
    excludeKeywords,
  };
}

export function getSearchRules(): SavedSearchRule[] {
  const db = getDb();
  ensureSearchRuleOrdering(db);
  return db.prepare(`
    SELECT id, name, label_color, query, keywords_json, settings_json, order_index, created_at, updated_at, last_run_at
    FROM search_rules
    ORDER BY order_index ASC, created_at ASC
  `).all().map((row) => {
    const data = row as {
      id: string;
      name: string;
      label_color: string | null;
      query: string;
      keywords_json: string;
      settings_json: string | null;
      order_index: number | null;
      created_at: string;
      updated_at: string;
      last_run_at: string | null;
    };

    return {
      id: data.id,
      name: data.name,
      ruleColor: normalizeSearchRuleColor(data.label_color),
      query: data.query,
      keywords: safeParseStringArray(data.keywords_json),
      settings: safeParseSearchRuleSettings(data.settings_json),
      orderIndex: data.order_index ?? 0,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      lastRunAt: data.last_run_at,
    };
  });
}

function getSearchRuleSaveSummary(ruleId: string): SearchRuleSaveSummary {
  const rule = getSearchRules().find((candidate) => candidate.id === ruleId);
  if (!rule) {
    throw new Error('Saved search rule not found after save');
  }

  return {
    id: rule.id,
    name: rule.name,
    ruleColor: rule.ruleColor,
    query: rule.query,
    settings: rule.settings,
  };
}

export function saveSearchRule(input: {
  id?: string;
  name?: string;
  query: string;
  ruleColor?: string | null;
  settings?: Partial<SearchRuleSettings> | null;
}) {
  const keywords = parseSearchKeywords(input.query);
  if (keywords.length === 0) {
    throw new Error('Search query must contain at least one keyword');
  }

  const db = getDb();
  const now = new Date().toISOString();
  const query = keywords.join(', ');
  const normalizedId = input.id?.trim();
  const id = normalizedId ? normalizedId : crypto.randomUUID();
  const name = input.name?.trim() || keywords.slice(0, 3).join(', ');
  const ruleColor = normalizeSearchRuleColor(input.ruleColor);
  const settings = normalizeSearchRuleSettings(input.settings);
  const orderIndex = normalizedId ? getExistingSearchRuleOrderIndex(db, normalizedId) : getNextSearchRuleOrderIndex(db);

  db.prepare(`
    INSERT INTO search_rules (id, name, label_color, query, keywords_json, settings_json, order_index, created_at, updated_at, last_run_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      label_color = excluded.label_color,
      query = excluded.query,
      keywords_json = excluded.keywords_json,
      settings_json = excluded.settings_json,
      updated_at = excluded.updated_at
  `).run(id, name, ruleColor, query, JSON.stringify(keywords), JSON.stringify(settings), orderIndex, now, now, null);

  return {
    savedRule: getSearchRuleSaveSummary(id),
    rules: getSearchRules().map((rule) => ({
      id: rule.id,
      name: rule.name,
      ruleColor: rule.ruleColor,
      query: rule.query,
      settings: rule.settings,
    })),
  };
}

export function deleteSearchRule(ruleId: string) {
  const db = getDb();
  db.prepare(`DELETE FROM search_rules WHERE id = ?`).run(ruleId);
  ensureSearchRuleOrdering(db, true);
  return getSearchRules();
}

export function reorderSearchRules(ruleIds: string[]) {
  const db = getDb();
  const existingRules = getSearchRules();
  if (ruleIds.length !== existingRules.length) {
    throw new Error('Saved rule order payload is incomplete');
  }

  const existingIds = new Set(existingRules.map((rule) => rule.id));
  if (ruleIds.some((id) => !existingIds.has(id))) {
    throw new Error('Saved rule order payload contains unknown rules');
  }

  db.exec('BEGIN');
  try {
    const updateStatement = db.prepare('UPDATE search_rules SET order_index = ? WHERE id = ?');
    ruleIds.forEach((ruleId, index) => {
      updateStatement.run(index, ruleId);
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return getSearchRules();
}

export function touchSearchRuleLastRun(ruleId: string) {
  const db = getDb();
  db.prepare(`
    UPDATE search_rules
    SET last_run_at = ?, updated_at = CASE WHEN last_run_at IS NULL THEN updated_at ELSE updated_at END
    WHERE id = ?
  `).run(new Date().toISOString(), ruleId);
}

export function runArticleSearch(
  query: string,
  options?: { days?: number; limit?: number; ruleId?: string; settings?: Partial<SearchRuleSettings> | null },
): { keywords: string[]; results: SearchResult[]; mode: 'full' | 'lite' } {
  const keywords = parseSearchKeywords(query);
  const settings = normalizeSearchRuleSettings(options?.settings);
  if (keywords.length === 0) {
    return { keywords: [], results: [], mode: 'full' };
  }

  const db = getDb();
  const { sql, params, mode } = buildSearchQuery(keywords, settings, options);
  if (mode === 'lite') {
    console.warn(`[search] ${keywords.length} keywords exceeds lite-search threshold (${LITE_SEARCH_KEYWORD_THRESHOLD}); entity/theme matching and scoring are disabled for this query.`);
  }
  const rows = db.prepare(sql).all(...params) as SearchRow[];
  const now = new Date().toISOString();

  if (options?.ruleId) {
    db.prepare(`
      UPDATE search_rules
      SET last_run_at = ?, updated_at = CASE WHEN last_run_at IS NULL THEN updated_at ELSE updated_at END
      WHERE id = ?
    `).run(now, options.ruleId);
  } else {
    db.prepare(`
      UPDATE search_rules
      SET last_run_at = ?, updated_at = CASE WHEN last_run_at IS NULL THEN updated_at ELSE updated_at END
      WHERE query = ?
    `).run(now, keywords.join(', '));
  }

  const results = annotateEscalationSignals(rows.map((row) => ({
    id: row.id,
    title: row.title,
    url: row.canonical_url,
    publishedAt: row.published_at ?? row.created_at,
    sourceTitle: row.source_title,
    sourceUrl: row.source_url,
    contentSnippet: row.content_snippet,
    rawContent: row.raw_content,
    category: row.primary_category,
    importanceScore: Number((row.importance_score ?? 0).toFixed(2)),
    matchedTerms: keywords.filter((keyword) => matchesKeyword(row, keyword)),
    relevance: Number(row.relevance.toFixed(2)),
    escalationCount24h: 1,
    isEscalating: false,
  })));

  return {
    keywords,
    results,
    mode,
  };
}

export function getSearchRuleMonitoring(days = 7, now = Date.now()): MonitoringGroup[] {
  const rules = getSearchRules();
  const db = getDb();
  const cutoff = new Date(now - days * 86_400_000).toISOString();

  return rules.map((rule) => {
    const parts = buildSearchQueryParts(rule.keywords, rule.settings);
    const countRow = db.prepare(`
      SELECT
        COUNT(*) AS articleCount,
        COUNT(DISTINCT COALESCE(a.source_title, a.source_url, a.id)) AS feedCount,
        MAX(COALESCE(a.published_at, a.created_at)) AS latestPublishedAt,
        AVG((${parts.scoreExpression}) + COALESCE(aa.importance_score, 0)) AS averageRelevance
      FROM articles a
      LEFT JOIN article_analysis aa ON aa.article_id = a.id
      WHERE (${parts.whereClause}) AND COALESCE(a.published_at, a.created_at) >= ?
    `).get(...parts.scoreParams, ...parts.whereParams, cutoff) as {
      articleCount: number | null;
      feedCount: number | null;
      latestPublishedAt: string | null;
      averageRelevance: number | null;
    };

    const rows = db.prepare(`
      SELECT
        a.id,
        a.title,
        a.canonical_url,
        a.published_at,
        a.created_at,
        a.source_title,
        a.source_url,
        a.content_snippet,
        a.raw_content,
        aa.primary_category,
        aa.importance_score,
        (${parts.scoreExpression}) + COALESCE(aa.importance_score, 0) AS relevance
      FROM articles a
      LEFT JOIN article_analysis aa ON aa.article_id = a.id
      WHERE (${parts.whereClause}) AND COALESCE(a.published_at, a.created_at) >= ?
      ORDER BY COALESCE(a.published_at, a.created_at) DESC, relevance DESC
      LIMIT 120
    `).all(...parts.scoreParams, ...parts.whereParams, cutoff) as SearchRow[];

    const results: SearchResult[] = annotateEscalationSignals(rows.map((row) => ({
      id: row.id,
      title: row.title,
      url: row.canonical_url,
      publishedAt: row.published_at ?? row.created_at,
      sourceTitle: row.source_title,
      sourceUrl: row.source_url,
      contentSnippet: row.content_snippet,
      rawContent: row.raw_content,
      category: row.primary_category,
      importanceScore: Number((row.importance_score ?? 0).toFixed(2)),
      matchedTerms: rule.keywords.filter((keyword) => matchesKeyword(row, keyword)),
      relevance: Number(row.relevance.toFixed(2)),
      escalationCount24h: 1,
      isEscalating: false,
    })), now);

    return summarizeMonitoringGroup(rule, results, {
      articleCount: countRow.articleCount ?? 0,
      feedCount: countRow.feedCount ?? 0,
      latestPublishedAt: countRow.latestPublishedAt,
      averageRelevance: countRow.averageRelevance ?? 0,
    }, now);
  });
}

function ensureSearchRuleOrdering(db: ReturnType<typeof getDb>, compact = false) {
  const rules = db.prepare(`
    SELECT id, order_index, created_at, updated_at
    FROM search_rules
    ORDER BY
      CASE WHEN order_index IS NULL THEN 1 ELSE 0 END,
      order_index ASC,
      updated_at DESC,
      created_at DESC
  `).all() as Array<{
    id: string;
    order_index: number | null;
    created_at: string;
    updated_at: string;
  }>;

  if (rules.length === 0) return;

  const needsNormalization = compact || rules.some((rule, index) => rule.order_index !== index);
  if (!needsNormalization) return;

  const updateStatement = db.prepare('UPDATE search_rules SET order_index = ? WHERE id = ?');
  for (let index = 0; index < rules.length; index += 1) {
    updateStatement.run(index, rules[index].id);
  }
}

function getNextSearchRuleOrderIndex(db: ReturnType<typeof getDb>) {
  ensureSearchRuleOrdering(db);
  const row = db.prepare('SELECT COALESCE(MAX(order_index), -1) AS max_order_index FROM search_rules').get() as {
    max_order_index: number;
  };
  return row.max_order_index + 1;
}

function getExistingSearchRuleOrderIndex(db: ReturnType<typeof getDb>, ruleId: string) {
  ensureSearchRuleOrdering(db);
  const row = db.prepare('SELECT order_index FROM search_rules WHERE id = ?').get(ruleId) as {
    order_index: number;
  } | undefined;
  return row?.order_index ?? getNextSearchRuleOrderIndex(db);
}

export function summarizeMonitoringGroup(
  rule: SavedSearchRule,
  rows: SearchResult[],
  counts: {
    articleCount: number;
    feedCount: number;
    latestPublishedAt: string | null;
    averageRelevance: number;
  },
  now = Date.now(),
): MonitoringGroup {
  const sentimentScore = computeAggregateSentiment(rows);
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    ruleColor: rule.ruleColor,
    query: rule.query,
    keywords: rule.keywords,
    settings: rule.settings,
    articleCount: counts.articleCount,
    feedCount: counts.feedCount,
    latestPublishedAt: counts.latestPublishedAt,
    averageRelevance: Number(counts.averageRelevance.toFixed(2)),
    sentimentScore,
    sentimentLabel: sentimentScore > 0.2 ? 'positive' : sentimentScore < -0.2 ? 'negative' : 'neutral',
    escalatingCount: rows.filter((row) => row.isEscalating).length,
    breakingHighlights: buildBreakingHighlights(rows, now).slice(0, 3),
  };
}

function buildSearchQuery(
  keywords: string[],
  settings: SearchRuleSettings,
  options?: { days?: number; limit?: number },
) {
  const parts = buildSearchQueryParts(keywords, settings);
  const filters = [`(${parts.whereClause})`];
  const params: Array<string | number> = [...parts.scoreParams, ...parts.whereParams];
  if (typeof options?.days === 'number' && options.days > 0) {
    filters.push(`COALESCE(a.published_at, a.created_at) >= ?`);
    params.push(new Date(Date.now() - options.days * 86_400_000).toISOString());
  }
  const limit = typeof options?.limit === 'number' && options.limit > 0 ? Math.min(options.limit, 500) : 60;
  params.push(limit);
  const sql = `
    SELECT
      a.id,
      a.title,
      a.canonical_url,
      a.published_at,
      a.created_at,
      a.source_title,
      a.source_url,
      a.content_snippet,
      a.raw_content,
      aa.primary_category,
      aa.importance_score,
      (${parts.scoreExpression}) + COALESCE(aa.importance_score, 0) AS relevance
    FROM articles a
    LEFT JOIN article_analysis aa ON aa.article_id = a.id
    WHERE ${filters.join(' AND ')}
    ORDER BY
      COALESCE(a.published_at, a.created_at) DESC,
      relevance DESC,
      COALESCE(aa.importance_score, 0) DESC,
      a.updated_at DESC
    LIMIT ?
  `;

  return { sql, params, mode: parts.mode };
}

function buildSearchQueryParts(keywords: string[], settings: SearchRuleSettings): SearchQueryParts {
  if (keywords.length > LITE_SEARCH_KEYWORD_THRESHOLD) {
    return buildLiteSearchQueryParts(keywords, settings);
  }

  const includeWhereParts: string[] = [];
  const scoreParts: string[] = [];
  const scoreParams: string[] = [];
  const whereParams: string[] = [];

  for (const keyword of keywords) {
    const like = toLikeParam(keyword);

    includeWhereParts.push(`(
      lower(a.title) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(a.content_snippet, '')) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(a.raw_content, '')) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(a.source_title, '')) LIKE ? ESCAPE '\\'
      OR EXISTS (
        SELECT 1
        FROM article_themes at
        JOIN themes t ON t.id = at.theme_id
        WHERE at.article_id = a.id AND lower(t.name) LIKE ? ESCAPE '\\'
      )
      OR EXISTS (
        SELECT 1
        FROM article_entities ae
        JOIN entities e ON e.id = ae.entity_id
        WHERE ae.article_id = a.id AND lower(e.name) LIKE ? ESCAPE '\\'
      )
    )`);

    scoreParts.push(`(
      CASE WHEN lower(a.title) LIKE ? ESCAPE '\\' THEN 14 ELSE 0 END +
      CASE WHEN lower(COALESCE(a.content_snippet, '')) LIKE ? ESCAPE '\\' THEN 5 ELSE 0 END +
      CASE WHEN lower(COALESCE(a.raw_content, '')) LIKE ? ESCAPE '\\' THEN 2 ELSE 0 END +
      CASE WHEN lower(COALESCE(a.source_title, '')) LIKE ? ESCAPE '\\' THEN 3 ELSE 0 END +
      CASE WHEN EXISTS (
        SELECT 1
        FROM article_themes at
        JOIN themes t ON t.id = at.theme_id
        WHERE at.article_id = a.id AND lower(t.name) LIKE ? ESCAPE '\\'
      ) THEN 6 ELSE 0 END +
      CASE WHEN EXISTS (
        SELECT 1
        FROM article_entities ae
        JOIN entities e ON e.id = ae.entity_id
        WHERE ae.article_id = a.id AND lower(e.name) LIKE ? ESCAPE '\\'
      ) THEN 7 ELSE 0 END
    )`);

    scoreParams.push(like, like, like, like, like, like);
    whereParams.push(like, like, like, like, like, like);
  }

  const includeJoiner = settings.matchMode === 'and' ? ' AND ' : ' OR ';
  const whereParts: string[] = [`(${includeWhereParts.join(includeJoiner)})`];

  for (const keyword of settings.excludeKeywords) {
    const like = toLikeParam(keyword);
    whereParts.push(`NOT (
      lower(a.title) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(a.content_snippet, '')) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(a.raw_content, '')) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(a.source_title, '')) LIKE ? ESCAPE '\\'
      OR EXISTS (
        SELECT 1
        FROM article_themes at
        JOIN themes t ON t.id = at.theme_id
        WHERE at.article_id = a.id AND lower(t.name) LIKE ? ESCAPE '\\'
      )
      OR EXISTS (
        SELECT 1
        FROM article_entities ae
        JOIN entities e ON e.id = ae.entity_id
        WHERE ae.article_id = a.id AND lower(e.name) LIKE ? ESCAPE '\\'
      )
    )`);
    whereParams.push(like, like, like, like, like, like);
  }

  return {
    whereClause: whereParts.join(' AND '),
    whereParams,
    scoreExpression: scoreParts.join(' + '),
    scoreParams,
    mode: 'full',
  };
}

function buildLiteSearchQueryParts(keywords: string[], settings: SearchRuleSettings): SearchQueryParts {
  const includeWhereParts: string[] = [];
  const scoreParts: string[] = [];
  const scoreParams: string[] = [];
  const whereParams: string[] = [];

  for (const keyword of keywords) {
    const like = toLikeParam(keyword);

    includeWhereParts.push(`(
      lower(a.title) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(a.content_snippet, '')) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(a.raw_content, '')) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(a.source_title, '')) LIKE ? ESCAPE '\\'
    )`);

    scoreParts.push(`(
      CASE WHEN lower(a.title) LIKE ? ESCAPE '\\' THEN 10 ELSE 0 END +
      CASE WHEN lower(COALESCE(a.content_snippet, '')) LIKE ? ESCAPE '\\' THEN 4 ELSE 0 END +
      CASE WHEN lower(COALESCE(a.raw_content, '')) LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END +
      CASE WHEN lower(COALESCE(a.source_title, '')) LIKE ? ESCAPE '\\' THEN 2 ELSE 0 END
    )`);

    scoreParams.push(like, like, like, like);
    whereParams.push(like, like, like, like);
  }

  const includeJoiner = settings.matchMode === 'and' ? ' AND ' : ' OR ';
  const whereParts: string[] = [`(${includeWhereParts.join(includeJoiner)})`];

  for (const keyword of settings.excludeKeywords) {
    const like = toLikeParam(keyword);
    whereParts.push(`NOT (
      lower(a.title) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(a.content_snippet, '')) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(a.raw_content, '')) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(a.source_title, '')) LIKE ? ESCAPE '\\'
    )`);
    whereParams.push(like, like, like, like);
  }

  return {
    whereClause: whereParts.join(' AND '),
    whereParams,
    scoreExpression: scoreParts.join(' + '),
    scoreParams,
    mode: 'lite',
  };
}

function matchesKeyword(row: SearchRow, keyword: string) {
  const haystacks = [
    row.title,
    row.source_title ?? '',
    row.content_snippet ?? '',
    row.raw_content ?? '',
  ].map((value) => value.toLowerCase());

  return haystacks.some((value) => value.includes(keyword));
}

export function annotateEscalationSignals(rows: SearchResult[], now = Date.now()): SearchResult[] {
  const counts = new Map<string, number>();
  const keys = new Map<string, string>();

  for (const row of rows) {
    const publishedAt = row.publishedAt ? Date.parse(row.publishedAt) : NaN;
    if (!Number.isFinite(publishedAt) || now - publishedAt > ESCALATION_WINDOW_MS || publishedAt > now) {
      continue;
    }

    const key = buildEscalationKey(row.title);
    keys.set(row.id, key);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return rows.map((row) => {
    const key = keys.get(row.id);
    if (!key) {
      return {
        ...row,
        escalationCount24h: 1,
        isEscalating: false,
      };
    }

    const escalationCount24h = counts.get(key) ?? 1;
    return {
      ...row,
      escalationCount24h,
      isEscalating: escalationCount24h >= 2,
    };
  });
}

function buildEscalationKey(title: string) {
  const normalized = title
    .toLowerCase()
    .replace(/^(breaking|update|live|exclusive|analysis|opinion|突发|快讯|更新)\s*[:：-]\s*/iu, '')
    .replace(/https?:\/\/\S+/giu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return title.toLowerCase().trim();
  }

  const tokens = normalized.split(' ').filter((token) => token.length > 1);
  if (tokens.length >= 3) {
    return tokens.slice(0, 8).join(' ');
  }

  return normalized.slice(0, 80);
}

function computeAggregateSentiment(rows: Array<Pick<SearchResult, 'title' | 'contentSnippet'>>) {
  if (rows.length === 0) return 0;
  const total = rows.reduce((sum, row) => sum + scoreSentiment(`${row.title}\n${row.contentSnippet ?? ''}`), 0);
  return Number(Math.max(-1, Math.min(1, total / rows.length)).toFixed(2));
}

function scoreSentiment(text: string) {
  const normalized = text.toLowerCase();
  let score = 0;
  for (const term of POSITIVE_TERMS) {
    if (normalized.includes(term.toLowerCase())) score += 1;
  }
  for (const term of NEGATIVE_TERMS) {
    if (normalized.includes(term.toLowerCase())) score -= 1;
  }
  return Math.max(-3, Math.min(3, score)) / 3;
}

function buildBreakingHighlights(rows: SearchResult[], now: number): MonitoringHighlight[] {
  return rows
    .map((row) => ({
      ...row,
      breakingScore: computeBreakingScore(row, now),
    }))
    .filter((row) => row.breakingScore > 0)
    .sort((left, right) => right.breakingScore - left.breakingScore || right.relevance - left.relevance)
    .map((row) => ({
      id: row.id,
      title: row.title,
      url: row.url,
      publishedAt: row.publishedAt,
      sourceTitle: row.sourceTitle,
      relevance: row.relevance,
      importanceScore: row.importanceScore,
      matchedTerms: row.matchedTerms,
    }));
}

function computeBreakingScore(row: SearchResult, now: number) {
  const text = `${row.title}\n${row.contentSnippet ?? ''}`.toLowerCase();
  const urgencyBoost = BREAKING_TERMS.reduce((score, term) => score + (text.includes(term.toLowerCase()) ? 8 : 0), 0);
  const publishedAt = row.publishedAt ? Date.parse(row.publishedAt) : 0;
  const ageHours = publishedAt ? Math.max(0, (now - publishedAt) / 3_600_000) : 48;
  const recencyBoost = Math.max(0, 24 - ageHours) * 0.5;
  return Number((row.relevance + row.importanceScore * 0.5 + urgencyBoost + recencyBoost).toFixed(2));
}
