import 'server-only';

import { embedText } from '@/lib/ai/providers';
import { getDb } from './db';
import { findNearestArticles } from './article-vectors-repository';
import { DEDUP_DISTANCE_THRESHOLD } from './dedup';
import { getServerAISettings } from './settings-repository';
import { BREAKING_TERMS, TERM_SPLIT_PATTERN, toLikeParam } from './search-terms';
import type {
  SmartSearchAlert,
  SmartSearchCandidate,
  SmartSearchFacets,
  SmartSearchGroup,
  SmartSearchOptions,
  SmartSearchQueryPlan,
  SmartSearchResponse,
  SmartSearchResult,
  SmartSearchScoreBreakdown,
  SmartSearchSqlRow,
  SmartSearchTag,
} from './smart-search-types';

const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/;
const LATIN_PATTERN = /[a-z]/i;

const SPORTS_TERMS = ['world cup', 'fifa', 'match', 'goal', 'england', 'football', 'soccer', '世界杯'];
const POLICY_TERMS = ['policy', 'regulation', 'tariff', 'export controls', 'sanctions', '监管', '关税', '制裁', '出口管制'];
const MARKET_TERMS = ['market', 'stock', 'earnings', 'revenue', 'funding', 'ipo', 'shares', 'profit'];
const RESEARCH_TERMS = ['history', 'background', 'explainer', 'timeline', 'archive', 'why', 'how'];

// How many nearest neighbors to pull from article_vectors per query. Only candidates that
// also survived the lexical/entity/theme SQL filter end up scored; this just needs to be
// generously larger than a typical candidate set so real matches aren't cut off.
const SEMANTIC_NEIGHBOR_LIMIT = 300;
// L2 distance beyond which an article is treated as semantically unrelated (score 0).
// Calibrated off DEDUP_DISTANCE_THRESHOLD (near-duplicate cutoff, ~3.75): topically related
// but non-duplicate articles land well above that, so the falloff needs a lot more headroom.
const SEMANTIC_DISTANCE_CEILING = DEDUP_DISTANCE_THRESHOLD * 6;

const JUNK_ENTITY_NAMES = new Set([
  'article url',
  'comments url',
  'url',
  'telegram channel',
  'read more',
  'source',
  'image',
  'stock photo',
  'author',
  'newsletter',
  'unknown',
]);

const GENERIC_THEME_NAMES = new Set(['world', 'news', 'general', 'latest', 'article']);

export function buildSmartSearchQueryPlan(query: string): SmartSearchQueryPlan {
  const originalQuery = query;
  const rawTerms = splitQueryTerms(query);
  const includeTerms: string[] = [];
  const excludeTerms: string[] = [];

  let exclusionMode = false;
  for (let index = 0; index < rawTerms.length; index += 1) {
    const rawTerm = rawTerms[index];
    if (rawTerm === 'exclude:' || rawTerm === '-') {
      exclusionMode = true;
      const next = rawTerms[index + 1];
      if (next) {
        excludeTerms.push(next);
        index += 1;
      }
      continue;
    }

    if (rawTerm.startsWith('exclude:')) {
      exclusionMode = true;
      const excluded = rawTerm.slice('exclude:'.length).trim();
      if (excluded) excludeTerms.push(excluded);
      continue;
    }

    if (rawTerm.startsWith('-')) {
      exclusionMode = true;
      const excluded = rawTerm.slice(1).trim();
      if (excluded) excludeTerms.push(excluded);
      continue;
    }

    if (exclusionMode) {
      excludeTerms.push(rawTerm);
      continue;
    }

    includeTerms.push(rawTerm);
  }

  const keywords = dedupe(includeTerms);
  const normalizedQuery = keywords.join(' ');
  return {
    originalQuery,
    normalizedQuery,
    keywords,
    phrases: keywords.filter((term) => term.includes(' ')),
    includeTerms: keywords,
    excludeTerms: dedupe(excludeTerms),
    detectedLanguage: detectLanguage(query),
    intent: detectIntent(normalizedQuery),
  };
}

export function isJunkSearchEntity(name: string | null | undefined) {
  const normalized = normalizeText(name ?? '');
  if (!normalized) return true;
  if (JUNK_ENTITY_NAMES.has(normalized)) return true;
  if (/^https?:\/\//i.test(normalized)) return true;
  if (/\b(article url|comments url|url)\b/i.test(normalized)) return true;
  if (/\.(com|net|org|io|co|my|cn|sg)(\/|$)/i.test(normalized)) return true;
  if (normalized.length <= 1) return true;
  return false;
}

export function rankSmartSearchCandidates(
  plan: SmartSearchQueryPlan,
  candidates: SmartSearchCandidate[],
  now = Date.now(),
  semanticScores: Map<string, number> = new Map(),
): SmartSearchResult[] {
  return candidates
    .map((candidate) => scoreCandidate(plan, candidate, now, semanticScores))
    .sort((left, right) => right.score.final - left.score.final || compareDatesDesc(left.publishedAt, right.publishedAt));
}

/**
 * Embeds the query and looks up its nearest article vectors, giving a 0-100 semantic score
 * per article id. Fails open (empty map) if AI is disabled or embedding errors — semantic
 * just drops out of the blend rather than breaking search.
 */
async function computeSemanticScores(queryText: string): Promise<Map<string, number>> {
  const settings = getServerAISettings();
  if (!settings.enabled) return new Map();

  try {
    const embedding = await embedText('ollama', queryText, {
      model: settings.embedModel,
      baseUrl: settings.baseUrl,
    });
    const neighbors = findNearestArticles(embedding, SEMANTIC_NEIGHBOR_LIMIT);
    return new Map(neighbors.map((neighbor) => [neighbor.articleId, distanceToSemanticScore(neighbor.distance)]));
  } catch (error) {
    console.error('[smart-search] semantic embedding failed:', error);
    return new Map();
  }
}

function distanceToSemanticScore(distance: number) {
  return Math.max(0, Math.min(100, 100 * (1 - distance / SEMANTIC_DISTANCE_CEILING)));
}





export async function runSmartArticleSearch(
  query: string,
  options: SmartSearchOptions = {},
): Promise<SmartSearchResponse> {
  const queryPlan = buildSmartSearchQueryPlan(query);
  if (options.excludeKeywords?.length) {
    queryPlan.excludeTerms = dedupe([...queryPlan.excludeTerms, ...options.excludeKeywords.map((term) => normalizeText(term))]);
  }
  if (queryPlan.includeTerms.length === 0) {
    return emptySmartSearchResponse(queryPlan);
  }

  // Kick off the embedding request before the (synchronous) DB query so the network
  // round-trip overlaps with SQL execution instead of adding to it serially.
  const semanticScoresPromise = computeSemanticScores(queryPlan.normalizedQuery);

  const db = getDb();
  const { sql, params } = buildSmartCandidateSql(queryPlan, options);
  const rows = db.prepare(sql).all(...params) as SmartSearchSqlRow[];
  const candidates = mapSmartSearchRows(rows);
  const semanticScores = await semanticScoresPromise;
  const results = rankSmartSearchCandidates(queryPlan, candidates, Date.now(), semanticScores).slice(0, normalizeLimit(options.limit));
  const groups = buildSmartSearchGroups(results);
  const alerts = detectSmartSearchAlerts(groups, results);

  return {
    keywords: queryPlan.keywords,
    queryPlan,
    results,
    groups,
    alerts,
    facets: buildSmartSearchFacets(results),
    debugSignals: options.includeDebug ? buildDebugSignals(results) : [],
    llmStatus: options.useLlm ? { enabled: true, used: false, timedOut: false } : { enabled: false, used: false, timedOut: false },
  };
}

function emptySmartSearchResponse(queryPlan: SmartSearchQueryPlan): SmartSearchResponse {
  return {
    keywords: [],
    queryPlan,
    results: [],
    groups: [],
    alerts: [],
    facets: { sources: [], entities: [], themes: [], languages: [] },
    debugSignals: [],
    llmStatus: { enabled: false, used: false, timedOut: false },
  };
}

function buildSmartCandidateSql(queryPlan: SmartSearchQueryPlan, options: SmartSearchOptions) {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  for (const term of queryPlan.includeTerms) {
    const like = toLikeParam(term);
    conditions.push(`(
      lower(a.title) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(a.content_snippet, '')) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(a.raw_content, '')) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(a.scraped_text, '')) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(a.source_title, '')) LIKE ? ESCAPE '\\'
      OR EXISTS (
        SELECT 1
        FROM article_entities ae_match
        JOIN entities e_match ON e_match.id = ae_match.entity_id
        WHERE ae_match.article_id = a.id AND lower(e_match.name) LIKE ? ESCAPE '\\'
      )
      OR EXISTS (
        SELECT 1
        FROM article_themes at_match
        JOIN themes t_match ON t_match.id = at_match.theme_id
        WHERE at_match.article_id = a.id AND lower(t_match.name) LIKE ? ESCAPE '\\'
      )
    )`);
    params.push(like, like, like, like, like, like, like);
  }

  // Matches classic search's matchMode: 'or' additively boosts recall (any term can surface a
  // candidate, which is then ranked), 'and' requires every include term to hit somewhere.
  const includeJoiner = options.matchMode === 'and' ? ' AND ' : ' OR ';
  const whereParts: string[] = [`(${conditions.join(includeJoiner)})`];

  for (const term of queryPlan.excludeTerms) {
    const like = toLikeParam(term);
    whereParts.push(`NOT (
      lower(a.title) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(a.content_snippet, '')) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(a.raw_content, '')) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(a.scraped_text, '')) LIKE ? ESCAPE '\\'
    )`);
    params.push(like, like, like, like);
  }

  // Bug fix: this used to be appended into `conditions` (the OR'd include-term block), which
  // meant "published recently" alone could satisfy the WHERE clause regardless of any keyword
  // match. It must gate the whole result set, not be one more OR branch inside it.
  if (typeof options.days === 'number' && options.days > 0) {
    whereParts.push(`COALESCE(a.published_at, a.created_at) >= ?`);
    params.push(new Date(Date.now() - Math.min(options.days, 3650) * 86_400_000).toISOString());
  }

  const candidateLimit = Math.max(80, Math.min(500, normalizeLimit(options.limit) * 5));
  params.push(candidateLimit);

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
      a.scraped_text,
      a.language,
      aa.primary_category,
      aa.importance_score,
      e.id AS entity_id,
      e.name AS entity_name,
      e.entity_type,
      ae.mention_count,
      ae.weight AS entity_weight,
      ae.salience AS entity_salience,
      t.id AS theme_id,
      t.name AS theme_name,
      t.category_hint,
      at.score AS theme_score
    FROM articles a
    LEFT JOIN article_analysis aa ON aa.article_id = a.id
    LEFT JOIN article_entities ae ON ae.article_id = a.id
    LEFT JOIN entities e ON e.id = ae.entity_id
    LEFT JOIN article_themes at ON at.article_id = a.id
    LEFT JOIN themes t ON t.id = at.theme_id
    WHERE ${whereParts.join(' AND ')}
    ORDER BY COALESCE(a.published_at, a.created_at) DESC
    LIMIT ?
  `;

  return { sql, params };
}

function normalizeLimit(limit: number | undefined) {
  return typeof limit === 'number' && limit > 0 ? Math.min(limit, 500) : 60;
}

function buildSmartSearchFacets(results: SmartSearchResult[]): SmartSearchFacets {
  return {
    sources: countFacet(results.map((result) => result.sourceTitle).filter((value): value is string => Boolean(value))),
    entities: countFacet(results.flatMap((result) => result.entities.filter((entity) => !entity.isJunk && !isJunkSearchEntity(entity.name)).map((entity) => entity.name))),
    themes: countFacet(results.flatMap((result) => result.themes.filter((theme) => !GENERIC_THEME_NAMES.has(normalizeText(theme.name))).map((theme) => theme.name))),
    languages: countFacet(results.map((result) => result.language).filter((value): value is string => Boolean(value))),
  };
}

function buildDebugSignals(results: SmartSearchResult[]) {
  return results.map((result) => ({
    articleId: result.id,
    stage: 'rank',
    message: result.reasons.join('; ') || 'Ranked by deterministic smart-search score',
    value: result.score,
  }));
}

function countFacet(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 20)
    .map(([name, count]) => ({ name, count }));
}

export function mapSmartSearchRows(rows: SmartSearchSqlRow[]): SmartSearchCandidate[] {
  const candidates = new Map<string, SmartSearchCandidate>();
  const entitySeen = new Map<string, Set<string>>();
  const themeSeen = new Map<string, Set<string>>();

  for (const row of rows) {
    let candidate = candidates.get(row.id);
    if (!candidate) {
      candidate = {
        id: row.id,
        title: row.title,
        url: row.canonical_url,
        publishedAt: row.published_at ?? row.created_at,
        sourceTitle: row.source_title,
        sourceUrl: row.source_url,
        contentSnippet: row.content_snippet,
        rawContent: row.raw_content,
        scrapedText: row.scraped_text,
        language: row.language,
        category: row.primary_category,
        importanceScore: row.importance_score ?? 0,
        entities: [],
        themes: [],
      };
      candidates.set(row.id, candidate);
      entitySeen.set(row.id, new Set());
      themeSeen.set(row.id, new Set());
    }

    if (row.entity_id && row.entity_name && !entitySeen.get(row.id)?.has(row.entity_id)) {
      candidate.entities.push({
        id: row.entity_id,
        name: row.entity_name,
        type: row.entity_type ?? 'UNKNOWN',
        mentionCount: row.mention_count ?? 0,
        weight: row.entity_weight ?? 0,
        salience: row.entity_salience,
        isJunk: isJunkSearchEntity(row.entity_name),
      });
      entitySeen.get(row.id)?.add(row.entity_id);
    }

    if (row.theme_id && row.theme_name && !themeSeen.get(row.id)?.has(row.theme_id)) {
      candidate.themes.push({
        id: row.theme_id,
        name: row.theme_name,
        score: row.theme_score ?? 0,
        categoryHint: row.category_hint,
      });
      themeSeen.get(row.id)?.add(row.theme_id);
    }
  }

  return Array.from(candidates.values());
}

export function buildSmartSearchTags(candidate: SmartSearchCandidate, plan: SmartSearchQueryPlan): SmartSearchTag[] {
  const tags = buildBasicTags(candidate, plan);
  const text = normalizeText(`${candidate.title}\n${candidate.contentSnippet ?? ''}\n${candidate.rawContent ?? ''}`);
  if (/\b(sued|sues|lawsuit|court|copyright|legal)\b/i.test(text) || text.includes('诉讼')) {
    tags.push({ type: 'event', label: 'lawsuit', confidence: 0.8 });
  }
  if (/\b(acquires|acquisition|merger|funding|earnings|launch|breach|outage|tariff|sanctions)\b/i.test(text)) {
    tags.push({ type: 'event', label: 'market signal', confidence: 0.65 });
  }
  return dedupeTags(tags);
}

export function buildSmartSearchGroups(results: SmartSearchResult[]): SmartSearchGroup[] {
  const buckets = new Map<string, SmartSearchResult[]>();
  for (const result of results) {
    const groupableKey = buildGroupableStoryKey(result);
    const bucket = buckets.get(groupableKey) ?? [];
    bucket.push(result);
    buckets.set(groupableKey, bucket);
  }

  return Array.from(buckets.entries())
    .map(([storyKey, bucket]) => buildGroup(storyKey, bucket))
    .filter((group) => !isJunkSearchEntity(group.title) && group.title !== 'Article URL / World')
    .sort((left, right) => right.relevanceScore - left.relevanceScore || right.articleCount - left.articleCount);
}

export function detectSmartSearchAlerts(
  groups: SmartSearchGroup[],
  results: SmartSearchResult[],
  now = Date.now(),
): SmartSearchAlert[] {
  const resultsById = new Map(results.map((result) => [result.id, result]));
  const alerts: SmartSearchAlert[] = [];
  for (const group of groups) {
    const groupResults = group.topArticleIds.map((id) => resultsById.get(id)).filter((item): item is SmartSearchResult => Boolean(item));
    const recentResults = groupResults.filter((result) => {
      const publishedAt = result.publishedAt ? Date.parse(result.publishedAt) : NaN;
      return Number.isFinite(publishedAt) && now - publishedAt <= 6 * 60 * 60 * 1000;
    });
    const recentSources = new Set(recentResults.map((result) => result.sourceTitle ?? result.sourceUrl ?? result.id));

    if (recentSources.size >= 2 && recentResults.length >= 2) {
      alerts.push({
        type: recentSources.size >= 3 || recentResults.length >= 3 ? 'breaking' : 'escalating',
        severity: recentSources.size >= 3 || recentResults.length >= 3 ? 'high' : 'medium',
        title: `${group.title} is accelerating`,
        reason: `${recentResults.length} matching articles from ${recentSources.size} sources in the last 6 hours`,
        articleIds: recentResults.map((result) => result.id),
        entities: group.topEntities,
        themes: group.topThemes,
      });
    }
  }
  return alerts;
}

function scoreCandidate(
  plan: SmartSearchQueryPlan,
  candidate: SmartSearchCandidate,
  now: number,
  semanticScores: Map<string, number>,
): SmartSearchResult {
  const title = normalizeText(candidate.title);
  const snippet = normalizeText(candidate.contentSnippet ?? '');
  const raw = normalizeText(candidate.rawContent ?? candidate.scrapedText ?? '');
  const source = normalizeText(candidate.sourceTitle ?? '');
  const text = `${title}\n${snippet}\n${raw}\n${source}`;
  const matchedTerms = plan.includeTerms.filter((term) => text.includes(term));
  const reasons: string[] = [];

  const lexical = computeLexicalScore(plan, { title, snippet, raw, source }, reasons);
  const entity = computeEntityScore(plan, candidate, reasons);
  const theme = computeThemeScore(plan, candidate, reasons);
  const importance = clampScore(candidate.importanceScore);
  const freshness = computeFreshnessScore(candidate.publishedAt, now);
  const sourceQuality = candidate.sourceTitle ? 65 : 30;
  const semantic = semanticScores.get(candidate.id) ?? 0;
  if (semantic >= 50) reasons.push('Semantically similar to query');
  const penalties = computePenalties(plan, candidate, { lexical, entity, theme, semantic });
  const velocity = 0;
  const final = roundScore(
    lexical * 0.35
      + entity * 0.15
      + theme * 0.15
      + semantic * 0.10
      + importance * 0.10
      + freshness * 0.10
      + sourceQuality * 0.05
      + velocity * 0.05
      - penalties,
  );

  const score: SmartSearchScoreBreakdown = {
    lexical: roundScore(lexical),
    entity: roundScore(entity),
    theme: roundScore(theme),
    semantic,
    importance: roundScore(importance),
    freshness: roundScore(freshness),
    velocity,
    sourceQuality: roundScore(sourceQuality),
    penalties: roundScore(penalties),
    final,
  };

  return {
    ...candidate,
    matchedTerms,
    tags: buildSmartSearchTags(candidate, plan),
    score,
    reasons,
    storyKey: buildStoryKey(candidate),
  };
}

function computeLexicalScore(
  plan: SmartSearchQueryPlan,
  haystacks: { title: string; snippet: string; raw: string; source: string },
  reasons: string[],
) {
  if (plan.includeTerms.length === 0) return 0;
  let score = 0;
  let titleMatches = 0;

  for (const term of plan.includeTerms) {
    const termScore =
      (haystacks.title.includes(term) ? 45 : 0)
      + (haystacks.snippet.includes(term) ? 25 : 0)
      + (haystacks.raw.includes(term) ? 10 : 0)
      + (haystacks.source.includes(term) ? 8 : 0);
    if (haystacks.title.includes(term)) titleMatches += 1;
    score += termScore;
  }

  const coverageBoost = (countCoveredTerms(plan.includeTerms, `${haystacks.title}\n${haystacks.snippet}\n${haystacks.raw}`) / plan.includeTerms.length) * 25;
  if (titleMatches >= Math.min(2, plan.includeTerms.length)) reasons.push('Strong title match');
  return Math.min(100, score / Math.max(1, plan.includeTerms.length) + coverageBoost);
}

function computeEntityScore(plan: SmartSearchQueryPlan, candidate: SmartSearchCandidate, reasons: string[]) {
  const meaningfulEntities = candidate.entities.filter((entity) => !entity.isJunk && !isJunkSearchEntity(entity.name));
  if (meaningfulEntities.length === 0) return 0;

  let score = 0;
  for (const entity of meaningfulEntities) {
    const normalizedName = normalizeText(entity.name);
    const directMatch = plan.includeTerms.some((term) => normalizedName.includes(term) || term.includes(normalizedName));
    if (directMatch) {
      score += 45 + Math.min(20, entity.mentionCount * 4) + Math.min(20, entity.weight * 5);
      reasons.push(`Entity match: ${entity.name}`);
    } else if (plan.normalizedQuery.includes(normalizedName)) {
      score += 35;
      reasons.push(`Entity match: ${entity.name}`);
    } else {
      score += Math.min(20, (entity.salience ?? 0) * 20 + entity.weight * 2);
    }
  }

  return Math.min(100, score);
}

function computeThemeScore(plan: SmartSearchQueryPlan, candidate: SmartSearchCandidate, reasons: string[]) {
  let score = 0;
  for (const theme of candidate.themes) {
    const normalizedName = normalizeText(theme.name);
    const normalizedCategory = normalizeText(theme.categoryHint ?? '');
    const directMatch = plan.includeTerms.some((term) => normalizedName.includes(term) || term.includes(normalizedName));
    const categoryMatch = normalizedCategory && plan.includeTerms.some((term) => normalizedCategory.includes(term) || term.includes(normalizedCategory));

    if (directMatch) {
      score += 35 + Math.min(25, theme.score * 5);
      reasons.push(`Theme match: ${theme.name}`);
    } else if (categoryMatch && !GENERIC_THEME_NAMES.has(normalizedCategory)) {
      score += 20 + Math.min(15, theme.score * 3);
      reasons.push(`Theme category match: ${theme.categoryHint}`);
    } else if (!GENERIC_THEME_NAMES.has(normalizedName)) {
      score += Math.min(15, theme.score * 2);
    }
  }
  return Math.min(100, score);
}

function computeFreshnessScore(publishedAt: string | null, now: number) {
  if (!publishedAt) return 20;
  const timestamp = Date.parse(publishedAt);
  if (!Number.isFinite(timestamp)) return 20;
  const ageHours = Math.max(0, (now - timestamp) / 3_600_000);
  if (ageHours <= 6) return 100;
  if (ageHours <= 24) return 85;
  if (ageHours <= 72) return 70;
  if (ageHours <= 24 * 7) return 50;
  if (ageHours <= 24 * 30) return 25;
  return 10;
}

function computePenalties(
  plan: SmartSearchQueryPlan,
  candidate: SmartSearchCandidate,
  scores: { lexical: number; entity: number; theme: number; semantic: number },
) {
  let penalties = 0;
  const hasJunkEntity = candidate.entities.some((entity) => entity.isJunk || isJunkSearchEntity(entity.name));
  const hasMeaningfulEntity = candidate.entities.some((entity) => !entity.isJunk && !isJunkSearchEntity(entity.name));
  const title = normalizeText(candidate.title);

  if (hasJunkEntity) penalties += hasMeaningfulEntity ? 8 : 30;
  if ((candidate.contentSnippet?.trim().length ?? 0) < 40 && (candidate.rawContent?.trim().length ?? 0) < 120) penalties += 10;
  // A strong semantic match (paraphrase, no shared literal keywords) shouldn't eat the
  // "everything's weak" penalty meant for genuinely unrelated junk.
  if (scores.lexical < 15 && scores.entity < 10 && scores.theme < 10 && scores.semantic < 50) penalties += 25;
  if (plan.includeTerms.some((term) => isJunkSearchEntity(term)) && title.includes('article url')) penalties += 35;
  if (candidate.themes.every((theme) => GENERIC_THEME_NAMES.has(normalizeText(theme.name))) && !hasMeaningfulEntity) penalties += 15;

  return penalties;
}

function buildBasicTags(candidate: SmartSearchCandidate, plan: SmartSearchQueryPlan): SmartSearchTag[] {
  const tags: SmartSearchTag[] = [];
  for (const entity of candidate.entities.filter((item) => !item.isJunk && !isJunkSearchEntity(item.name)).slice(0, 5)) {
    tags.push({ type: 'entity', label: entity.name, confidence: Math.min(1, Math.max(0.2, entity.weight / 5)) });
  }
  for (const theme of candidate.themes.filter((item) => !GENERIC_THEME_NAMES.has(normalizeText(item.name))).slice(0, 5)) {
    tags.push({ type: 'theme', label: theme.name, confidence: Math.min(1, Math.max(0.2, theme.score / 10)) });
  }
  if (plan.intent !== 'general') tags.push({ type: 'intent', label: plan.intent, confidence: 0.8 });
  if (candidate.language) tags.push({ type: 'language', label: candidate.language, confidence: 0.7 });
  return tags;
}

function buildStoryKey(candidate: SmartSearchCandidate) {
  const topEntity = candidate.entities.find((entity) => !entity.isJunk && !isJunkSearchEntity(entity.name))?.name;
  const topTheme = candidate.themes.find((theme) => !GENERIC_THEME_NAMES.has(normalizeText(theme.name)))?.name;
  const fallback = normalizeText(candidate.title).split(' ').slice(0, 8).join(' ');
  return `${normalizeText(topEntity ?? fallback)}::${normalizeText(topTheme ?? candidate.category ?? 'general')}`;
}

function splitQueryTerms(query: string) {
  const hasExplicitSeparator = /[,\n;，；]+/.test(query);
  return dedupe(
    query
      .split(TERM_SPLIT_PATTERN)
      .flatMap((part) => splitWhitespaceTerms(part, hasExplicitSeparator))
      .map((term) => normalizeText(term))
      .filter(Boolean),
  );
}

function splitWhitespaceTerms(value: string, preserveSimplePhrases: boolean) {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.includes(' ') && (CJK_PATTERN.test(trimmed) || /^(-|exclude:)/i.test(trimmed) || /\s(-|exclude:)/i.test(trimmed))) {
    return trimmed.split(/\s+/);
  }
  if (!trimmed.includes(' ')) {
    return [trimmed];
  }
  return preserveSimplePhrases ? [trimmed] : trimmed.split(/\s+/);
}

function detectLanguage(query: string): SmartSearchQueryPlan['detectedLanguage'] {
  const hasCjk = CJK_PATTERN.test(query);
  const hasLatin = LATIN_PATTERN.test(query);
  if (hasCjk && hasLatin) return 'mixed';
  if (hasCjk) return 'zh';
  if (hasLatin) return 'en';
  return 'unknown';
}

function detectIntent(normalizedQuery: string): SmartSearchQueryPlan['intent'] {
  if (BREAKING_TERMS.some((term) => normalizedQuery.includes(term))) return 'breaking';
  if (SPORTS_TERMS.some((term) => normalizedQuery.includes(term))) return 'sports';
  if (POLICY_TERMS.some((term) => normalizedQuery.includes(term))) return 'policy';
  if (MARKET_TERMS.some((term) => normalizedQuery.includes(term))) return 'market';
  if (RESEARCH_TERMS.some((term) => normalizedQuery.includes(term))) return 'research';
  return 'general';
}

function countCoveredTerms(terms: string[], text: string) {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ');
}

function dedupe(values: string[]) {
  return Array.from(new Set(values));
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}

function roundScore(value: number) {
  return Number(Math.max(0, Math.min(100, value)).toFixed(2));
}

function compareDatesDesc(left: string | null, right: string | null) {
  const leftTime = left ? Date.parse(left) : 0;
  const rightTime = right ? Date.parse(right) : 0;
  return rightTime - leftTime;
}


function dedupeTags(tags: SmartSearchTag[]) {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    const key = `${tag.type}:${tag.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildGroupableStoryKey(result: SmartSearchResult) {
  const topEntity = result.entities.find((entity) => !entity.isJunk && !isJunkSearchEntity(entity.name))?.name;
  const topTheme = result.themes.find((theme) => !GENERIC_THEME_NAMES.has(normalizeText(theme.name)))?.name;
  if (topEntity && topTheme) return `${normalizeText(topEntity)}::${normalizeText(topTheme)}`;
  if (topEntity) return `${normalizeText(topEntity)}::${normalizeText(result.category ?? 'general')}`;
  return normalizeTitleStem(result.title);
}

function buildGroup(storyKey: string, bucket: SmartSearchResult[]): SmartSearchGroup {
  const sorted = [...bucket].sort((left, right) => right.score.final - left.score.final);
  const sourceCount = new Set(bucket.map((result) => result.sourceTitle ?? result.sourceUrl ?? result.id)).size;
  const dates = bucket
    .map((result) => result.publishedAt)
    .filter((date): date is string => Boolean(date))
    .sort();
  const topEntities = topNames(bucket.flatMap((result) => result.entities.filter((entity) => !entity.isJunk && !isJunkSearchEntity(entity.name)).map((entity) => entity.name)));
  const topThemes = topNames(bucket.flatMap((result) => result.themes.filter((theme) => !GENERIC_THEME_NAMES.has(normalizeText(theme.name))).map((theme) => theme.name)));
  const title = topEntities[0] && topThemes[0]
    ? `${topEntities[0]} / ${topThemes[0]}`
    : sorted[0].title;

  return {
    id: storyKey,
    title,
    storyKey,
    articleCount: bucket.length,
    sourceCount,
    firstSeenAt: dates[0] ?? null,
    latestSeenAt: dates[dates.length - 1] ?? null,
    topEntities,
    topThemes,
    topArticleIds: sorted.map((result) => result.id),
    velocityScore: Math.min(100, bucket.length * 20 + sourceCount * 15),
    relevanceScore: roundScore(bucket.reduce((sum, result) => sum + result.score.final, 0) / bucket.length),
  };
}

function topNames(names: string[]) {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name]) => name)
    .slice(0, 5);
}

function normalizeTitleStem(title: string) {
  return normalizeText(title)
    .replace(/^(breaking|update|live|exclusive|analysis|opinion|突发|快讯|更新)\s*[:：-]\s*/i, '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[^a-z0-9\u3400-\u9fff\uf900-\ufaff\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 8)
    .join(' ');
}
