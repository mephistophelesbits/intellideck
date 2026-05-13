import 'server-only';

import crypto from 'crypto';
import { Article } from '@/lib/types';
import { getDb } from './db';
import { classifyCategory, extractEntities, extractLocations, extractThemes } from './intelligence';
import type { ScrapedArticle } from './article-scraper';
import {
  computePreferenceBoost,
  getFeedbackCount,
  getFeedbackValues,
  getPreferenceWeightMap,
  type RecommendationVariant,
} from './preferences-repository';

type KeywordCloudRow = {
  name: string;
  category_hint: string | null;
  story_count: number;
  total_score: number;
};

type LocationRow = {
  name: string;
  country_code: string;
  lat: number;
  lng: number;
  location_type: string;
  mentions: number;
  article_count: number;
  source_count?: number;
  primary_category?: string | null;
  top_anchor?: string | null;
};

type CountryHeatRow = {
  country_code: string;
  country_name: string;
  mentions: number;
  article_count: number;
  source_count: number;
  weighted_score: number;
  primary_category: string | null;
  top_anchor: string | null;
};

type ArticleRow = {
  id: string;
  canonical_url: string;
  title: string;
  published_at: string | null;
  source_url: string;
  source_title: string | null;
};

type TrendSeriesRow = {
  snapshot_date: string;
  metric_key: string;
  value: number;
};

type BriefingContextArticle = {
  id: string;
  title: string;
  canonical_url: string;
  source_title: string | null;
  primary_category: string | null;
  importance_score: number | null;
};

type ArticleTagType = 'category' | 'topic' | 'geo' | 'entity' | 'source';

type ArticleTag = {
  name: string;
  type: ArticleTagType;
  score: number;
};

const PRIORITY_INTEREST_TAGS = new Map<string, number>([
  ['ai', 36],
  ['ai models', 36],
  ['ai regulation', 24],
  ['technology', 32],
  ['semiconductors', 34],
  ['cloud infrastructure', 28],
  ['cybersecurity', 26],
  ['open source', 22],
  ['electric vehicles', 18],
  ['business', 26],
  ['markets', 24],
  ['industrial policy', 22],
  ['monetary policy', 16],
  ['market volatility', 14],
  ['trade policy', 12],
]);

const PRIORITY_INTEREST_PATTERNS: Array<[RegExp, number]> = [
  [/\b(ai|llm|agentic|agent|artificial intelligence|machine learning)\b/i, 34],
  [/\b(openai|anthropic|nvidia|tsmc|amd|apple|microsoft|google|meta|amazon|tesla|bytedance|deepseek)\b/i, 28],
  [/\b(chip|chips|semiconductor|gpu|accelerator|data center|cloud|model|startup|venture|funding|ipo)\b/i, 26],
  [/\b(earnings|revenue|margin|profit|acquisition|merger|antitrust|regulation|export control|tariff)\b/i, 20],
  [/\b(人工智能|大模型|智能体|芯片|半导体|英伟达|台积电|创业|融资|并购|营收|利润|云计算|数据中心)\b/i, 30],
];

const LOWER_PRIORITY_NEWS_TAGS = new Map<string, number>([
  ['world', -18],
  ['politics', -20],
  ['elections', -24],
  ['military and defense', -20],
  ['geopolitical conflict', -18],
  ['china policy', -8],
  ['us-china', -6],
]);

const GENERIC_POLITICS_PATTERN = /\b(pm|prime minister|minister|election|poll|parliament|congress|senate|president|campaign|judicial|justice)\b/i;
const COLD_START_FEEDBACK_COUNT = 20;
const PERSONALIZED_FEEDBACK_COUNT = 80;

const LEGACY_DISPLAY_TAGS = new Set([
  'ai',
  'technology',
  'markets',
  'business',
  'politics',
  'world',
  'science',
  'health',
  'energy',
  'climate',
  'china',
  'southeast asia',
  'semiconductors',
  'ai models',
  'ai regulation',
  'cybersecurity',
  'cloud infrastructure',
  'trade policy',
  'monetary policy',
  'market volatility',
  'energy transition',
  'oil and gas',
  'electric vehicles',
  'military and defense',
  'geopolitical conflict',
  'elections',
  'industrial policy',
  'open source',
  'space launch',
  'biotech',
  'public health',
  'climate risk',
  'china policy',
  'us-china',
  'usa',
  'united states',
  'united kingdom',
  'malaysia',
  'singapore',
  'indonesia',
  'thailand',
  'vietnam',
  'philippines',
  'japan',
  'south korea',
  'india',
  'russia',
  'ukraine',
  'israel',
  'gaza',
  'taiwan',
  'germany',
  'france',
  'hong kong',
]);

type StorylineSeedArticle = {
  id: string;
  title: string;
  canonical_url: string;
  published_at: string | null;
  source_title: string | null;
  primary_category: string | null;
  importance_score: number | null;
};

type EnrichmentStatements = {
  analysisStatement: ReturnType<ReturnType<typeof getDb>['prepare']>;
  locationUpsert: ReturnType<ReturnType<typeof getDb>['prepare']>;
  selectLocationId: ReturnType<ReturnType<typeof getDb>['prepare']>;
  deleteArticleLocations: ReturnType<ReturnType<typeof getDb>['prepare']>;
  insertArticleLocation: ReturnType<ReturnType<typeof getDb>['prepare']>;
  entityUpsert: ReturnType<ReturnType<typeof getDb>['prepare']>;
  selectEntityId: ReturnType<ReturnType<typeof getDb>['prepare']>;
  deleteArticleEntities: ReturnType<ReturnType<typeof getDb>['prepare']>;
  insertArticleEntity: ReturnType<ReturnType<typeof getDb>['prepare']>;
  themeUpsert: ReturnType<ReturnType<typeof getDb>['prepare']>;
  selectThemeId: ReturnType<ReturnType<typeof getDb>['prepare']>;
  deleteArticleThemes: ReturnType<ReturnType<typeof getDb>['prepare']>;
  insertArticleTheme: ReturnType<ReturnType<typeof getDb>['prepare']>;
};

export function persistArticles(sourceUrl: string, sourceTitle: string | undefined, articles: Article[]) {
  if (articles.length === 0) return;

  const db = getDb();
  const now = new Date().toISOString();

  const articleStatement = db.prepare(`
    INSERT INTO articles (
      id, source_url, source_title, canonical_url, title, published_at, author, content_snippet,
      raw_content, scraped_html, scraped_text, language, image_url, hash_fingerprint, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_url) DO UPDATE SET
      source_url = excluded.source_url,
      source_title = excluded.source_title,
      title = excluded.title,
      published_at = CASE
        WHEN excluded.published_at IS NULL THEN articles.published_at
        WHEN articles.published_at IS NULL THEN excluded.published_at
        WHEN articles.published_at GLOB '????-??-??T*' THEN articles.published_at
        ELSE excluded.published_at
      END,
      author = excluded.author,
      content_snippet = excluded.content_snippet,
      raw_content = CASE
        WHEN length(COALESCE(articles.raw_content, '')) > length(COALESCE(excluded.raw_content, ''))
          THEN articles.raw_content
        ELSE excluded.raw_content
      END,
      image_url = excluded.image_url,
      hash_fingerprint = excluded.hash_fingerprint,
      updated_at = excluded.updated_at
  `);
  const enrichmentStatements = createEnrichmentStatements(db);

  for (const article of articles) {
    const canonicalUrl = article.link || article.id;
    const articleId = canonicalUrl;
    articleStatement.run(
      articleId,
      sourceUrl,
      sourceTitle ?? null,
      canonicalUrl,
      article.title,
      article.pubDate || null,
      article.author || null,
      article.contentSnippet || null,
      article.content || null,
      null,
      null,
      null,
      article.thumbnail || null,
      hashArticle(article),
      now,
      now
    );
    upsertArticleEnrichment(enrichmentStatements, {
      articleId,
      title: article.title,
      contentSnippet: article.contentSnippet || null,
      rawContent: article.content || null,
      sourceTitle: sourceTitle ?? null,
      pubDate: article.pubDate || null,
      analyzedAt: now,
    });
  }

  rebuildTrendSnapshots();
}

export function updateArticleFullContent(articleId: string, scraped: ScrapedArticle) {
  const db = getDb();
  const analyzedAt = new Date().toISOString();

  db.prepare(`
    UPDATE articles
    SET
      raw_content = CASE
        WHEN length(COALESCE(raw_content, '')) > length(?)
          THEN raw_content
        ELSE ?
      END,
      scraped_html = ?,
      scraped_text = ?,
      content_snippet = CASE
        WHEN content_snippet IS NULL OR length(content_snippet) < 80
          THEN ?
        ELSE content_snippet
      END,
      author = COALESCE(author, ?)
    WHERE id = ? OR canonical_url = ?
  `).run(
    scraped.content,
    scraped.content,
    scraped.content,
    scraped.textContent,
    scraped.excerpt || scraped.textContent.slice(0, 300),
    scraped.byline,
    articleId,
    articleId
  );

  const enrichedRow = db.prepare(`
    SELECT id, title, content_snippet, raw_content, source_title, published_at
    FROM articles
    WHERE id = ? OR canonical_url = ?
    LIMIT 1
  `).get(articleId, articleId) as {
    id: string;
    title: string;
    content_snippet: string | null;
    raw_content: string | null;
    source_title: string | null;
    published_at: string | null;
  } | undefined;

  if (!enrichedRow) return;

  upsertArticleEnrichment(createEnrichmentStatements(db), {
    articleId: enrichedRow.id,
    title: enrichedRow.title,
    contentSnippet: enrichedRow.content_snippet,
    rawContent: enrichedRow.raw_content,
    sourceTitle: enrichedRow.source_title,
    pubDate: enrichedRow.published_at,
    analyzedAt,
  });
}

export function reprocessStoredArticles(limit = 500) {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = db.prepare(`
    SELECT id, title, content_snippet, raw_content, source_title, published_at
    FROM articles
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: string;
    title: string;
    content_snippet: string | null;
    raw_content: string | null;
    source_title: string | null;
    published_at: string | null;
  }>;
  const enrichmentStatements = createEnrichmentStatements(db);

  for (const row of rows) {
    upsertArticleEnrichment(enrichmentStatements, {
      articleId: row.id,
      title: row.title,
      contentSnippet: row.content_snippet,
      rawContent: row.raw_content,
      sourceTitle: row.source_title,
      pubDate: row.published_at,
      analyzedAt: now,
    });
  }

  rebuildTrendSnapshots();

  return {
    processedCount: rows.length,
    analyzedAt: now,
  };
}

function createEnrichmentStatements(db: ReturnType<typeof getDb>): EnrichmentStatements {
  return {
    analysisStatement: db.prepare(`
      INSERT INTO article_analysis (
        article_id, primary_category, tags_json, importance_score, analyzed_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(article_id) DO UPDATE SET
        primary_category = excluded.primary_category,
        tags_json = excluded.tags_json,
        importance_score = excluded.importance_score,
        analyzed_at = excluded.analyzed_at
    `),
    locationUpsert: db.prepare(`
      INSERT INTO locations (
        id, name, normalized_name, country_code, lat, lng, location_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(normalized_name) DO UPDATE SET
        name = excluded.name,
        country_code = excluded.country_code,
        lat = excluded.lat,
        lng = excluded.lng,
        location_type = excluded.location_type,
        updated_at = excluded.updated_at
    `),
    selectLocationId: db.prepare(`
      SELECT id FROM locations WHERE normalized_name = ?
    `),
    deleteArticleLocations: db.prepare(`DELETE FROM article_locations WHERE article_id = ?`),
    insertArticleLocation: db.prepare(`
      INSERT INTO article_locations (
        article_id, location_id, mention_count, weight, context_excerpt
      ) VALUES (?, ?, ?, ?, ?)
    `),
    entityUpsert: db.prepare(`
      INSERT INTO entities (
        id, name, normalized_name, entity_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(normalized_name) DO UPDATE SET
        name = excluded.name,
        entity_type = excluded.entity_type,
        updated_at = excluded.updated_at
    `),
    selectEntityId: db.prepare(`
      SELECT id FROM entities WHERE normalized_name = ?
    `),
    deleteArticleEntities: db.prepare(`DELETE FROM article_entities WHERE article_id = ?`),
    insertArticleEntity: db.prepare(`
      INSERT INTO article_entities (
        article_id, entity_id, mention_count, weight
      ) VALUES (?, ?, ?, ?)
    `),
    themeUpsert: db.prepare(`
      INSERT INTO themes (
        id, name, normalized_name, category_hint, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(normalized_name) DO UPDATE SET
        name = excluded.name,
        category_hint = excluded.category_hint,
        updated_at = excluded.updated_at
    `),
    selectThemeId: db.prepare(`
      SELECT id FROM themes WHERE normalized_name = ?
    `),
    deleteArticleThemes: db.prepare(`DELETE FROM article_themes WHERE article_id = ?`),
    insertArticleTheme: db.prepare(`
      INSERT INTO article_themes (
        article_id, theme_id, score
      ) VALUES (?, ?, ?)
    `),
  };
}

function upsertArticleEnrichment(
  statements: EnrichmentStatements,
  article: {
    articleId: string;
    title: string;
    contentSnippet: string | null;
    rawContent: string | null;
    sourceTitle: string | null;
    pubDate: string | null;
    analyzedAt: string;
  }
) {
  const combinedContent = `${article.contentSnippet || ''}\n${article.rawContent || ''}`;
  const category = classifyCategory(article.title, combinedContent);
  const locations = extractLocations(article.title, combinedContent);
  const entities = extractEntities(article.title, combinedContent);
  const themes = extractThemes(article.title, combinedContent, category);
  const tags = buildArticleTags({
    category,
    sourceTitle: article.sourceTitle,
    themes,
    locations,
    entities,
  });

  statements.analysisStatement.run(
    article.articleId,
    category,
    JSON.stringify(tags),
    computeImportance(
      {
        title: article.title,
        pubDate: article.pubDate ?? undefined,
        contentSnippet: article.contentSnippet ?? undefined,
      } as Article,
      locations.length
    ),
    article.analyzedAt
  );

  statements.deleteArticleLocations.run(article.articleId);
  for (const location of locations) {
    const derivedLocationId = `${location.countryCode}:${location.normalizedName}`;
    statements.locationUpsert.run(
      derivedLocationId,
      location.name,
      location.normalizedName,
      location.countryCode,
      location.lat,
      location.lng,
      location.locationType,
      article.analyzedAt,
      article.analyzedAt
    );
    const locationIdRow = statements.selectLocationId.get(location.normalizedName) as { id: string } | undefined;
    const locationId = locationIdRow?.id ?? derivedLocationId;
    statements.insertArticleLocation.run(
      article.articleId,
      locationId,
      location.mentionCount,
      location.mentionCount,
      article.contentSnippet?.slice(0, 240) || article.title
    );
  }

  statements.deleteArticleEntities.run(article.articleId);
  for (const entity of entities) {
    const derivedEntityId = `${entity.entityType}:${entity.normalizedName}`;
    statements.entityUpsert.run(
      derivedEntityId,
      entity.name,
      entity.normalizedName,
      entity.entityType,
      article.analyzedAt,
      article.analyzedAt
    );
    const entityIdRow = statements.selectEntityId.get(entity.normalizedName) as { id: string } | undefined;
    const entityId = entityIdRow?.id ?? derivedEntityId;
    statements.insertArticleEntity.run(
      article.articleId,
      entityId,
      entity.mentionCount,
      entity.mentionCount
    );
  }

  statements.deleteArticleThemes.run(article.articleId);
  for (const theme of themes) {
    const derivedThemeId = theme.normalizedName;
    statements.themeUpsert.run(
      derivedThemeId,
      theme.name,
      theme.normalizedName,
      theme.categoryHint,
      article.analyzedAt,
      article.analyzedAt
    );
    const themeIdRow = statements.selectThemeId.get(theme.normalizedName) as { id: string } | undefined;
    const themeId = themeIdRow?.id ?? derivedThemeId;
    statements.insertArticleTheme.run(
      article.articleId,
      themeId,
      theme.score
    );
  }
}

export function getIntelligenceOverview(days = 7) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const previousCutoff = new Date(Date.now() - days * 2 * 24 * 60 * 60 * 1000).toISOString();

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS article_count,
      COUNT(DISTINCT source_url) AS source_count,
      MAX(updated_at) AS last_ingested_at
    FROM articles
    WHERE updated_at >= ?
  `).get(cutoff) as {
    article_count: number;
    source_count: number;
    last_ingested_at: string | null;
  };

  const previousTotals = db.prepare(`
    SELECT
      COUNT(*) AS article_count,
      COUNT(DISTINCT source_url) AS source_count
    FROM articles
    WHERE updated_at >= ? AND updated_at < ?
  `).get(previousCutoff, cutoff) as {
    article_count: number;
    source_count: number;
  };

  const keywordCloud = db.prepare(`
    SELECT
      t.name,
      COALESCE(t.category_hint, aa.primary_category, 'General') AS category_hint,
      COUNT(DISTINCT at.article_id) AS story_count,
      SUM(at.score) AS total_score
    FROM article_themes at
    JOIN themes t ON t.id = at.theme_id
    JOIN articles a ON a.id = at.article_id
    LEFT JOIN article_analysis aa ON aa.article_id = a.id
    WHERE a.updated_at >= ?
    GROUP BY t.id, t.name, COALESCE(t.category_hint, aa.primary_category, 'General')
    ORDER BY total_score DESC, story_count DESC, t.name ASC
    LIMIT 18
  `).all(cutoff) as KeywordCloudRow[];

  const locations = db.prepare(`
    SELECT
      l.name,
      l.country_code,
      l.lat,
      l.lng,
      l.location_type,
      SUM(al.mention_count) AS mentions,
      COUNT(DISTINCT al.article_id) AS article_count,
      COUNT(DISTINCT a.source_url) AS source_count,
      MAX(aa.primary_category) AS primary_category,
      MAX(e.name) AS top_anchor
    FROM article_locations al
    JOIN locations l ON l.id = al.location_id
    JOIN articles a ON a.id = al.article_id
    LEFT JOIN article_analysis aa ON aa.article_id = a.id
    LEFT JOIN article_entities ae ON ae.article_id = a.id
    LEFT JOIN entities e ON e.id = ae.entity_id
    WHERE a.updated_at >= ?
    GROUP BY l.id
    ORDER BY mentions DESC, article_count DESC
    LIMIT 30
  `).all(cutoff) as LocationRow[];

  const countryHeat = db.prepare(`
    WITH location_rollup AS (
      SELECT
        l.country_code AS country_code,
        SUM(al.mention_count) AS mentions,
        COUNT(DISTINCT al.article_id) AS article_count,
        COUNT(DISTINCT a.source_url) AS source_count
      FROM article_locations al
      JOIN locations l ON l.id = al.location_id
      JOIN articles a ON a.id = al.article_id
      WHERE a.updated_at >= ?
      GROUP BY l.country_code
    ),
    category_rank AS (
      SELECT
        l.country_code AS country_code,
        aa.primary_category AS primary_category,
        COUNT(*) AS category_count,
        ROW_NUMBER() OVER (
          PARTITION BY l.country_code
          ORDER BY COUNT(*) DESC, aa.primary_category ASC
        ) AS category_rank
      FROM article_locations al
      JOIN locations l ON l.id = al.location_id
      JOIN articles a ON a.id = al.article_id
      LEFT JOIN article_analysis aa ON aa.article_id = a.id
      WHERE a.updated_at >= ?
      GROUP BY l.country_code, aa.primary_category
    ),
    anchor_rank AS (
      SELECT
        l.country_code AS country_code,
        e.name AS anchor_name,
        SUM(ae.mention_count) AS anchor_mentions,
        ROW_NUMBER() OVER (
          PARTITION BY l.country_code
          ORDER BY SUM(ae.mention_count) DESC, e.name ASC
        ) AS anchor_rank
      FROM article_locations al
      JOIN locations l ON l.id = al.location_id
      JOIN articles a ON a.id = al.article_id
      JOIN article_entities ae ON ae.article_id = a.id
      JOIN entities e ON e.id = ae.entity_id
      WHERE a.updated_at >= ?
      GROUP BY l.country_code, e.name
    )
    SELECT
      location_rollup.country_code,
      MAX(CASE WHEN l.location_type = 'country' THEN l.name END) AS country_name,
      location_rollup.mentions,
      location_rollup.article_count,
      location_rollup.source_count,
      ROUND((location_rollup.mentions * 1.25) + (location_rollup.article_count * 2.2) + (location_rollup.source_count * 1.8), 2) AS weighted_score,
      category_rank.primary_category,
      anchor_rank.anchor_name AS top_anchor
    FROM location_rollup
    LEFT JOIN locations l ON l.country_code = location_rollup.country_code
    LEFT JOIN category_rank
      ON category_rank.country_code = location_rollup.country_code
      AND category_rank.category_rank = 1
    LEFT JOIN anchor_rank
      ON anchor_rank.country_code = location_rollup.country_code
      AND anchor_rank.anchor_rank = 1
    GROUP BY
      location_rollup.country_code,
      location_rollup.mentions,
      location_rollup.article_count,
      location_rollup.source_count,
      category_rank.primary_category,
      anchor_rank.anchor_name
    ORDER BY weighted_score DESC, location_rollup.mentions DESC
  `).all(cutoff, cutoff, cutoff) as CountryHeatRow[];

  const recentArticles = db.prepare(`
    SELECT id, canonical_url, title, published_at, source_url, source_title
    FROM articles
    WHERE updated_at >= ?
    ORDER BY published_at DESC, updated_at DESC
    LIMIT 10
  `).all(cutoff) as ArticleRow[];

  const topMovers = db.prepare(`
    WITH current_window AS (
      SELECT aa.primary_category AS category, COUNT(*) AS count
      FROM article_analysis aa
      JOIN articles a ON a.id = aa.article_id
      WHERE a.updated_at >= ?
      GROUP BY aa.primary_category
    ),
    previous_window AS (
      SELECT aa.primary_category AS category, COUNT(*) AS count
      FROM article_analysis aa
      JOIN articles a ON a.id = aa.article_id
      WHERE a.updated_at >= ? AND a.updated_at < ?
      GROUP BY aa.primary_category
    ),
    category_keys AS (
      SELECT category FROM current_window
      UNION
      SELECT category FROM previous_window
    )
    SELECT
      category_keys.category AS category,
      COALESCE(current_window.count, 0) AS current_count,
      COALESCE(previous_window.count, 0) AS previous_count
    FROM category_keys
    LEFT JOIN current_window ON current_window.category = category_keys.category
    LEFT JOIN previous_window ON previous_window.category = category_keys.category
    ORDER BY (COALESCE(current_window.count, 0) - COALESCE(previous_window.count, 0)) DESC, current_count DESC
    LIMIT 6
  `).all(cutoff, previousCutoff, cutoff) as Array<{
    category: string;
    current_count: number;
    previous_count: number;
  }>;

  const trendSnapshots = db.prepare(`
    SELECT metric_key, value
    FROM trend_snapshots
    WHERE snapshot_date = ? AND window_type = ? AND metric_type = ?
    ORDER BY value DESC
    LIMIT 8
  `).all(currentSnapshotDate(), `${days}d`, 'category_count') as Array<{
    metric_key: string;
    value: number;
  }>;
  const feedHealth = db.prepare(`
    SELECT
      COUNT(*) AS total_feeds,
      SUM(CASE WHEN last_error IS NULL OR last_error = '' THEN 1 ELSE 0 END) AS healthy_feeds,
      SUM(CASE WHEN last_error IS NOT NULL AND last_error != '' THEN 1 ELSE 0 END) AS failing_feeds,
      SUM(CASE WHEN last_fetched_at IS NULL THEN 1 ELSE 0 END) AS never_fetched_feeds
    FROM saved_feeds
  `).get() as {
    total_feeds: number;
    healthy_feeds: number | null;
    failing_feeds: number | null;
    never_fetched_feeds: number | null;
  };
  const recentFeedErrors = db.prepare(`
    SELECT title, url, last_error, last_fetched_at
    FROM saved_feeds
    WHERE last_error IS NOT NULL AND last_error != ''
    ORDER BY last_fetched_at DESC, updated_at DESC
    LIMIT 5
  `).all() as Array<{
    title: string;
    url: string;
    last_error: string;
    last_fetched_at: string | null;
  }>;
  const storylines = getStorylineClusters(days);
  const mapLegend = {
    min: countryHeat.length ? Math.min(...countryHeat.map((item) => item.weighted_score)) : 0,
    max: countryHeat.length ? Math.max(...countryHeat.map((item) => item.weighted_score)) : 0,
  };

  return {
    totals: {
      articleCount: totals.article_count,
      sourceCount: totals.source_count,
      lastIngestedAt: totals.last_ingested_at,
    },
    comparisons: {
      articleDelta: totals.article_count - previousTotals.article_count,
      sourceDelta: totals.source_count - previousTotals.source_count,
    },
    feedHealth: {
      totalFeeds: feedHealth.total_feeds,
      healthyFeeds: feedHealth.healthy_feeds ?? 0,
      failingFeeds: feedHealth.failing_feeds ?? 0,
      neverFetchedFeeds: feedHealth.never_fetched_feeds ?? 0,
    },
    keywordCloud: keywordCloud.map((item) => ({
      id: item.name.toLowerCase().replace(/\s+/g, '-'),
      label: item.name,
      value: item.story_count,
      score: Number(item.total_score.toFixed(2)),
      category: item.category_hint ?? 'General',
    })),
    mapPoints: locations.map((item) => ({
      name: item.name,
      countryCode: item.country_code,
      lat: item.lat,
      lng: item.lng,
      locationType: item.location_type,
      mentions: item.mentions,
      articleCount: item.article_count,
      sourceCount: item.source_count ?? 0,
      primaryCategory: item.primary_category ?? null,
      topAnchor: item.top_anchor ?? null,
      weightedScore: Number(((item.mentions * 1.15) + (item.article_count * 2) + ((item.source_count ?? 0) * 1.5)).toFixed(2)),
    })),
    countryHeat: countryHeat.map((item) => ({
      countryCode: item.country_code,
      countryName: item.country_name || item.country_code,
      mentions: item.mentions,
      articleCount: item.article_count,
      sourceCount: item.source_count,
      weightedScore: item.weighted_score,
      primaryCategory: item.primary_category,
      topAnchor: item.top_anchor,
    })),
    mapLegend,
    recentArticles: recentArticles.map((article) => ({
      id: article.id,
      url: article.canonical_url,
      title: article.title,
      publishedAt: article.published_at,
      sourceUrl: article.source_url,
      sourceTitle: article.source_title,
    })),
    topMovers: topMovers.map((item) => ({
      category: item.category,
      currentCount: item.current_count,
      previousCount: item.previous_count,
      delta: item.current_count - item.previous_count,
    })),
    trendSnapshots: trendSnapshots.map((item) => ({
      label: item.metric_key,
      value: item.value,
    })),
    recentFeedErrors: recentFeedErrors.map((feed) => ({
      title: feed.title,
      url: feed.url,
      error: feed.last_error,
      lastFetchedAt: feed.last_fetched_at,
    })),
    storylines,
  };
}

export function getCountryDetail(countryCode: string, days = 7) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const summary = db.prepare(`
    WITH category_rank AS (
      SELECT
        aa.primary_category AS primary_category,
        COUNT(*) AS category_count
      FROM article_locations al
      JOIN locations l ON l.id = al.location_id
      JOIN articles a ON a.id = al.article_id
      LEFT JOIN article_analysis aa ON aa.article_id = a.id
      WHERE l.country_code = ? AND a.updated_at >= ?
      GROUP BY aa.primary_category
      ORDER BY category_count DESC, aa.primary_category ASC
      LIMIT 1
    ),
    anchor_rank AS (
      SELECT
        e.name AS anchor_name,
        SUM(ae.mention_count) AS anchor_mentions
      FROM article_locations al
      JOIN locations l ON l.id = al.location_id
      JOIN articles a ON a.id = al.article_id
      JOIN article_entities ae ON ae.article_id = a.id
      JOIN entities e ON e.id = ae.entity_id
      WHERE l.country_code = ? AND a.updated_at >= ?
      GROUP BY e.name
      ORDER BY anchor_mentions DESC, e.name ASC
      LIMIT 1
    )
    SELECT
      MAX(CASE WHEN l.location_type = 'country' THEN l.name END) AS country_name,
      COUNT(DISTINCT al.article_id) AS article_count,
      SUM(al.mention_count) AS mentions,
      COUNT(DISTINCT a.source_url) AS source_count,
      (SELECT primary_category FROM category_rank) AS primary_category,
      (SELECT anchor_name FROM anchor_rank) AS top_anchor
    FROM article_locations al
    JOIN locations l ON l.id = al.location_id
    JOIN articles a ON a.id = al.article_id
    WHERE l.country_code = ? AND a.updated_at >= ?
  `).get(countryCode, cutoff, countryCode, cutoff, countryCode, cutoff) as {
    country_name: string | null;
    article_count: number;
    mentions: number | null;
    source_count: number;
    primary_category: string | null;
    top_anchor: string | null;
  } | undefined;

  if (!summary || summary.article_count === 0) return null;

  const articles = db.prepare(`
    SELECT
      a.id,
      a.canonical_url,
      a.title,
      a.published_at,
      a.source_title,
      SUM(al.mention_count) AS mention_count
    FROM article_locations al
    JOIN locations l ON l.id = al.location_id
    JOIN articles a ON a.id = al.article_id
    WHERE l.country_code = ? AND a.updated_at >= ?
    GROUP BY a.id, a.canonical_url, a.title, a.published_at, a.source_title
    ORDER BY mention_count DESC, a.published_at DESC, a.updated_at DESC
    LIMIT 12
  `).all(countryCode, cutoff) as Array<{
    id: string;
    canonical_url: string;
    title: string;
    published_at: string | null;
    source_title: string | null;
    mention_count: number;
  }>;

  return {
    countryCode,
    countryName: summary.country_name || countryCode,
    mentions: summary.mentions ?? 0,
    articleCount: summary.article_count,
    sourceCount: summary.source_count,
    primaryCategory: summary.primary_category,
    topAnchor: summary.top_anchor,
    articles: articles.map((article) => ({
      id: article.id,
      url: article.canonical_url,
      title: article.title,
      publishedAt: article.published_at,
      sourceTitle: article.source_title,
      mentionCount: article.mention_count,
    })),
  };
}

export function getRecentArticlesForBriefing(limit = 50, days = 2) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const futureSkew = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  return db.prepare(`
    SELECT
      a.id,
      a.canonical_url,
      a.title,
      a.published_at,
      a.source_title,
      aa.primary_category,
      aa.importance_score,
      COUNT(DISTINCT ae.entity_id) AS entity_count,
      COUNT(DISTINCT at.theme_id) AS theme_count
    FROM articles a
    LEFT JOIN article_analysis aa ON aa.article_id = a.id
    LEFT JOIN article_entities ae ON ae.article_id = a.id
    LEFT JOIN article_themes at ON at.article_id = a.id
    WHERE COALESCE(a.published_at, a.created_at) >= ?
      AND COALESCE(a.published_at, a.created_at) <= ?
    GROUP BY a.id, a.canonical_url, a.title, a.published_at, a.source_title, aa.primary_category, aa.importance_score
    ORDER BY aa.importance_score DESC, entity_count DESC, theme_count DESC, COALESCE(a.published_at, a.created_at) DESC, a.updated_at DESC
    LIMIT ?
  `).all(cutoff, futureSkew, limit) as Array<{
    id: string;
    canonical_url: string;
    title: string;
    published_at: string | null;
    source_title: string | null;
    primary_category: string | null;
    importance_score: number | null;
    entity_count: number;
    theme_count: number;
  }>;
}

export function getTodayPriorityFeed(limit = 24, days = 2) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const futureSkew = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const rowLimit = Math.max(limit * 8, 240);
  const preferenceWeights = getPreferenceWeightMap();
  const feedbackCount = getFeedbackCount();
  const personalizationFactor = feedbackCount < COLD_START_FEEDBACK_COUNT
    ? 0.35
    : feedbackCount < PERSONALIZED_FEEDBACK_COUNT
      ? 0.7
      : 1;
  const explorationRate = feedbackCount < COLD_START_FEEDBACK_COUNT
    ? 0.3
    : feedbackCount < PERSONALIZED_FEEDBACK_COUNT
      ? 0.15
      : 0.08;
  const explorationCount = Math.max(1, Math.round(limit * explorationRate));

  const rows = db.prepare(`
    SELECT
      a.id,
      a.canonical_url,
      a.title,
      a.published_at,
      a.updated_at,
      a.source_title,
      a.source_url,
      a.author,
      a.content_snippet,
      a.raw_content,
      a.image_url,
      aa.primary_category,
      aa.tags_json,
      aa.importance_score,
      a.created_at,
      COUNT(DISTINCT ae.entity_id) AS entity_count,
      COUNT(DISTINCT at.theme_id) AS theme_count,
      COUNT(DISTINCT al.location_id) AS location_count
    FROM articles a
    LEFT JOIN article_analysis aa ON aa.article_id = a.id
    LEFT JOIN article_entities ae ON ae.article_id = a.id
    LEFT JOIN article_themes at ON at.article_id = a.id
    LEFT JOIN article_locations al ON al.article_id = a.id
    WHERE COALESCE(a.published_at, a.created_at) >= ?
      AND COALESCE(a.published_at, a.created_at) <= ?
    GROUP BY
      a.id,
      a.canonical_url,
      a.title,
      a.published_at,
      a.updated_at,
      a.source_title,
      a.source_url,
      a.author,
      a.content_snippet,
      a.raw_content,
      a.image_url,
      aa.primary_category,
      aa.tags_json,
      aa.importance_score,
      a.created_at
    ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.updated_at DESC, aa.importance_score DESC
    LIMIT ?
  `).all(cutoff, futureSkew, rowLimit) as Array<{
    id: string;
    canonical_url: string;
    title: string;
    published_at: string | null;
    updated_at: string;
    source_title: string | null;
    source_url: string;
    author: string | null;
    content_snippet: string | null;
    raw_content: string | null;
    image_url: string | null;
    primary_category: string | null;
    tags_json: string | null;
    importance_score: number | null;
    created_at: string;
    entity_count: number;
    theme_count: number;
    location_count: number;
  }>;

  const scored = rows.map((article) => {
    const displayDate = article.published_at || article.created_at;
    const displayTime = new Date(displayDate).getTime();
    const ageHours = Math.max(1, (Date.now() - displayTime) / (1000 * 60 * 60));
    const recencyBonus = Math.max(0, 24 - ageHours) * 1.2;
    const entityBonus = Math.min(24, article.entity_count * 4);
    const themeBonus = Math.min(18, article.theme_count * 3);
    const locationBonus = Math.min(10, article.location_count * 2.5);
    const categoryBonus = article.primary_category && article.primary_category !== 'General' ? 8 : 0;
    const parsedTags = parseArticleTags(article.tags_json);
    const interestBonus = computePriorityInterestBonus({
      title: article.title,
      summary: article.content_snippet,
      sourceTitle: article.source_title,
      category: article.primary_category,
      tags: parsedTags,
    });
    const basePriorityScore = Number(((article.importance_score ?? 0) + recencyBonus + entityBonus + themeBonus + locationBonus + categoryBonus + interestBonus).toFixed(2));
    const reasons = buildPriorityReasons({
      ageHours,
      primaryCategory: article.primary_category,
      entityCount: article.entity_count,
      themeCount: article.theme_count,
      locationCount: article.location_count,
      importanceScore: article.importance_score ?? 0,
    });
    const tags = getDisplayTags(parsedTags, article.primary_category, article.source_title);
    const preferenceBoost = Number((computePreferenceBoost({
      category: article.primary_category,
      sourceTitle: article.source_title,
      tags,
      tagDetails: parsedTags,
      weights: preferenceWeights,
    }) * personalizationFactor).toFixed(2));
    const priorityScore = Number((basePriorityScore + preferenceBoost).toFixed(2));

    const urgency: 'urgent' | 'important' | 'watch' = priorityScore >= 135 || (ageHours <= 4 && priorityScore >= 95)
      ? 'urgent'
      : priorityScore >= 105
        ? 'important'
        : 'watch';

    return {
      id: article.id,
      url: article.canonical_url,
      title: article.title,
      publishedAt: article.published_at,
      updatedAt: article.created_at,
      sourceTitle: article.source_title,
      sourceUrl: article.source_url,
      author: article.author,
      summary: article.content_snippet,
      content: article.raw_content,
      thumbnail: article.image_url,
      category: article.primary_category,
      tags,
      tagDetails: parsedTags,
      basePriorityScore,
      priorityScore,
      preferenceBoost,
      interestBonus,
      urgency,
      reasons,
      recommendationVariant: (preferenceBoost === 0 ? 'baseline' : 'personalized') as RecommendationVariant,
    };
  });

  const latestRelevant = scored
    .filter((item) =>
      item.interestBonus > 0 ||
      item.category === 'AI' ||
      item.category === 'Technology'
    )
    .sort((a, b) => new Date(b.publishedAt || b.updatedAt).getTime() - new Date(a.publishedAt || a.updatedAt).getTime())
    .slice(0, Math.min(8, limit));
  const topScored = scored
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, Math.max(1, limit - explorationCount));
  const selected = new Map<string, (typeof scored)[number]>();
  for (const item of [...latestRelevant, ...topScored]) {
    selected.set(item.id, item);
  }
  const explorationItems = scored
    .filter((item) => !selected.has(item.id))
    .filter((item) => item.basePriorityScore >= 45 || item.interestBonus > 0 || item.category !== 'General')
    .sort((a, b) => getExplorationScore(b.id) - getExplorationScore(a.id))
    .slice(0, explorationCount)
    .map((item) => ({
      ...item,
      recommendationVariant: 'exploration' as const,
    }));
  for (const item of explorationItems) {
    selected.set(item.id, item);
  }
  const feedbackValues = getFeedbackValues(Array.from(selected.keys()));

  return Array.from(selected.values())
    .sort((a, b) => {
      const dateDelta = new Date(b.publishedAt || b.updatedAt).getTime() - new Date(a.publishedAt || a.updatedAt).getTime();
      return dateDelta || b.priorityScore - a.priorityScore;
    })
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      url: item.url,
      title: item.title,
      publishedAt: item.publishedAt,
      updatedAt: item.updatedAt,
      sourceTitle: item.sourceTitle,
      sourceUrl: item.sourceUrl,
      author: item.author,
      summary: item.summary,
      content: item.content,
      thumbnail: item.thumbnail,
      category: item.category,
      tags: item.tags,
      tagDetails: item.tagDetails,
      priorityScore: item.priorityScore,
      basePriorityScore: item.basePriorityScore,
      preferenceBoost: item.preferenceBoost,
      recommendationVariant: item.recommendationVariant as RecommendationVariant,
      feedbackValue: feedbackValues.get(item.id) ?? 0,
      urgency: item.urgency,
      reasons: item.reasons,
    }));
}

function getExplorationScore(articleId: string) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const digest = crypto
    .createHash('sha256')
    .update(`${todayKey}:${articleId}`)
    .digest('hex')
    .slice(0, 8);
  return Number.parseInt(digest, 16) / 0xffffffff;
}

export function getLocationDetail(locationName: string, days = 7) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const location = db.prepare(`
    SELECT id, name, country_code, lat, lng, location_type
    FROM locations
    WHERE name = ? OR normalized_name = ?
    LIMIT 1
  `).get(locationName, locationName.toLowerCase()) as {
    id: string;
    name: string;
    country_code: string;
    lat: number;
    lng: number;
    location_type: string;
  } | undefined;

  if (!location) return null;

  const articles = db.prepare(`
    SELECT a.id, a.canonical_url, a.title, a.published_at, a.source_title, al.mention_count
    FROM article_locations al
    JOIN articles a ON a.id = al.article_id
    WHERE al.location_id = ? AND a.updated_at >= ?
    ORDER BY al.mention_count DESC, a.published_at DESC, a.updated_at DESC
    LIMIT 12
  `).all(location.id, cutoff) as Array<{
    id: string;
    canonical_url: string;
    title: string;
    published_at: string | null;
    source_title: string | null;
    mention_count: number;
  }>;

  return {
    name: location.name,
    countryCode: location.country_code,
    lat: location.lat,
    lng: location.lng,
    locationType: location.location_type,
    articles: articles.map((article) => ({
      id: article.id,
      url: article.canonical_url,
      title: article.title,
      publishedAt: article.published_at,
      sourceTitle: article.source_title,
      mentionCount: article.mention_count,
    })),
  };
}

export function getCategoryDetail(category: string, days = 7) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const articles = db.prepare(`
    SELECT
      a.id,
      a.canonical_url,
      a.title,
      a.published_at,
      a.source_title,
      aa.importance_score
    FROM article_analysis aa
    JOIN articles a ON a.id = aa.article_id
    WHERE aa.primary_category = ? AND a.updated_at >= ?
    ORDER BY aa.importance_score DESC, a.published_at DESC, a.updated_at DESC
    LIMIT 12
  `).all(category, cutoff) as Array<{
    id: string;
    canonical_url: string;
    title: string;
    published_at: string | null;
    source_title: string | null;
    importance_score: number;
  }>;

  const entities = db.prepare(`
    SELECT e.name, SUM(ae.mention_count) AS mentions
    FROM article_analysis aa
    JOIN article_entities ae ON ae.article_id = aa.article_id
    JOIN entities e ON e.id = ae.entity_id
    JOIN articles a ON a.id = aa.article_id
    WHERE aa.primary_category = ? AND a.updated_at >= ?
    GROUP BY e.id
    ORDER BY mentions DESC
    LIMIT 10
  `).all(category, cutoff) as Array<{ name: string; mentions: number }>;

  return {
    category,
    articles: articles.map((article) => ({
      id: article.id,
      url: article.canonical_url,
      title: article.title,
      publishedAt: article.published_at,
      sourceTitle: article.source_title,
      importanceScore: article.importance_score,
    })),
    topEntities: entities,
  };
}

export function getThemeDetail(themeName: string, days = 7) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const summary = db.prepare(`
    SELECT
      t.name,
      t.category_hint,
      COUNT(DISTINCT at.article_id) AS story_count,
      SUM(at.score) AS total_score
    FROM article_themes at
    JOIN themes t ON t.id = at.theme_id
    JOIN articles a ON a.id = at.article_id
    WHERE (t.name = ? OR t.normalized_name = ?) AND a.updated_at >= ?
    GROUP BY t.id, t.name, t.category_hint
    LIMIT 1
  `).get(themeName, themeName.toLowerCase(), cutoff) as {
    name: string;
    category_hint: string | null;
    story_count: number;
    total_score: number;
  } | undefined;

  if (!summary) return null;

  const articles = db.prepare(`
    SELECT
      a.id,
      a.canonical_url,
      a.title,
      a.published_at,
      a.source_title,
      aa.importance_score,
      at.score
    FROM article_themes at
    JOIN themes t ON t.id = at.theme_id
    JOIN articles a ON a.id = at.article_id
    LEFT JOIN article_analysis aa ON aa.article_id = a.id
    WHERE (t.name = ? OR t.normalized_name = ?) AND a.updated_at >= ?
    ORDER BY at.score DESC, aa.importance_score DESC, a.published_at DESC, a.updated_at DESC
    LIMIT 12
  `).all(themeName, themeName.toLowerCase(), cutoff) as Array<{
    id: string;
    canonical_url: string;
    title: string;
    published_at: string | null;
    source_title: string | null;
    importance_score: number;
    score: number;
  }>;

  const entities = db.prepare(`
    SELECT e.name, SUM(ae.mention_count) AS mentions
    FROM article_themes at
    JOIN themes t ON t.id = at.theme_id
    JOIN article_entities ae ON ae.article_id = at.article_id
    JOIN entities e ON e.id = ae.entity_id
    JOIN articles a ON a.id = at.article_id
    WHERE (t.name = ? OR t.normalized_name = ?) AND a.updated_at >= ?
    GROUP BY e.id
    ORDER BY mentions DESC
    LIMIT 10
  `).all(themeName, themeName.toLowerCase(), cutoff) as Array<{ name: string; mentions: number }>;

  return {
    theme: summary.name,
    category: summary.category_hint ?? 'General',
    storyCount: summary.story_count,
    totalScore: Number(summary.total_score.toFixed(2)),
    articles: articles.map((article) => ({
      id: article.id,
      url: article.canonical_url,
      title: article.title,
      publishedAt: article.published_at,
      sourceTitle: article.source_title,
      importanceScore: article.importance_score,
      keywordScore: Number(article.score.toFixed(2)),
    })),
    topEntities: entities,
  };
}

export function getBriefingContextPack(articleIds: string[], days = 7) {
  if (articleIds.length === 0) {
    return {
      articles: [] as Array<{
        id: string;
        title: string;
        url: string;
        sourceTitle: string | null;
        category: string | null;
        importanceScore: number | null;
        entities: Array<{ name: string; mentions: number }>;
        themes: Array<{ name: string; score: number }>;
        locations: Array<{ name: string; mentions: number }>;
      }>,
      dominantEntities: [] as Array<{ name: string; mentions: number }>,
      dominantThemes: [] as Array<{ name: string; score: number }>,
      dominantLocations: [] as Array<{ name: string; mentions: number }>,
      categoryMovers: [] as Array<{ category: string; delta: number; currentCount: number; previousCount: number }>,
      storylines: [] as Array<{
        id: string;
        title: string;
        category: string;
        anchorEntity: string | null;
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
        entities: Array<{ name: string; mentions: number }>;
        themes: Array<{ name: string; score: number }>;
        locations: Array<{ name: string; mentions: number }>;
      }>,
    };
  }

  const db = getDb();
  const placeholders = articleIds.map(() => '?').join(', ');
  const articles = db.prepare(`
    SELECT a.id, a.title, a.canonical_url, a.source_title, aa.primary_category, aa.importance_score
    FROM articles a
    LEFT JOIN article_analysis aa ON aa.article_id = a.id
    WHERE a.id IN (${placeholders})
  `).all(...articleIds) as BriefingContextArticle[];

  const entityRows = db.prepare(`
    SELECT ae.article_id, e.name, SUM(ae.mention_count) AS mentions
    FROM article_entities ae
    JOIN entities e ON e.id = ae.entity_id
    WHERE ae.article_id IN (${placeholders})
    GROUP BY ae.article_id, e.id
    ORDER BY mentions DESC
  `).all(...articleIds) as Array<{ article_id: string; name: string; mentions: number }>;

  const locationRows = db.prepare(`
    SELECT al.article_id, l.name, SUM(al.mention_count) AS mentions
    FROM article_locations al
    JOIN locations l ON l.id = al.location_id
    WHERE al.article_id IN (${placeholders})
    GROUP BY al.article_id, l.id
    ORDER BY mentions DESC
  `).all(...articleIds) as Array<{ article_id: string; name: string; mentions: number }>;
  const themeRows = db.prepare(`
    SELECT at.article_id, t.name, SUM(at.score) AS score
    FROM article_themes at
    JOIN themes t ON t.id = at.theme_id
    WHERE at.article_id IN (${placeholders})
    GROUP BY at.article_id, t.id
    ORDER BY score DESC
  `).all(...articleIds) as Array<{ article_id: string; name: string; score: number }>;

  const dominantEntities = db.prepare(`
    SELECT e.name, SUM(ae.mention_count) AS mentions
    FROM article_entities ae
    JOIN entities e ON e.id = ae.entity_id
    WHERE ae.article_id IN (${placeholders})
    GROUP BY e.id
    ORDER BY mentions DESC
    LIMIT 12
  `).all(...articleIds) as Array<{ name: string; mentions: number }>;
  const dominantThemes = db.prepare(`
    SELECT t.name, SUM(at.score) AS score
    FROM article_themes at
    JOIN themes t ON t.id = at.theme_id
    WHERE at.article_id IN (${placeholders})
    GROUP BY t.id
    ORDER BY score DESC
    LIMIT 10
  `).all(...articleIds) as Array<{ name: string; score: number }>;

  const dominantLocations = db.prepare(`
    SELECT l.name, SUM(al.mention_count) AS mentions
    FROM article_locations al
    JOIN locations l ON l.id = al.location_id
    WHERE al.article_id IN (${placeholders})
    GROUP BY l.id
    ORDER BY mentions DESC
    LIMIT 8
  `).all(...articleIds) as Array<{ name: string; mentions: number }>;

  return {
    articles: articles.map((article) => ({
      id: article.id,
      title: article.title,
      url: article.canonical_url,
      sourceTitle: article.source_title,
      category: article.primary_category,
      importanceScore: article.importance_score,
      entities: entityRows
        .filter((row) => row.article_id === article.id)
        .slice(0, 6)
        .map((row) => ({ name: row.name, mentions: row.mentions })),
      themes: themeRows
        .filter((row) => row.article_id === article.id)
        .slice(0, 5)
        .map((row) => ({ name: row.name, score: row.score })),
      locations: locationRows
        .filter((row) => row.article_id === article.id)
        .slice(0, 5)
        .map((row) => ({ name: row.name, mentions: row.mentions })),
    })),
    dominantEntities,
    dominantThemes,
    dominantLocations,
    categoryMovers: getIntelligenceOverview(days).topMovers,
    storylines: getStorylineClusters(days).slice(0, 6),
  };
}

export function getStorylineClusters(days = 7) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const articles = db.prepare(`
    SELECT
      a.id,
      a.title,
      a.canonical_url,
      a.published_at,
      a.source_title,
      aa.primary_category,
      aa.importance_score
    FROM articles a
    LEFT JOIN article_analysis aa ON aa.article_id = a.id
    WHERE a.updated_at >= ?
    ORDER BY aa.importance_score DESC, a.published_at DESC, a.updated_at DESC
    LIMIT 80
  `).all(cutoff) as StorylineSeedArticle[];

  const entityRows = db.prepare(`
    SELECT ae.article_id, e.name
    FROM article_entities ae
    JOIN entities e ON e.id = ae.entity_id
    JOIN articles a ON a.id = ae.article_id
    WHERE a.updated_at >= ?
    ORDER BY ae.mention_count DESC
  `).all(cutoff) as Array<{ article_id: string; name: string }>;
  const themeRows = db.prepare(`
    SELECT at.article_id, t.name
    FROM article_themes at
    JOIN themes t ON t.id = at.theme_id
    JOIN articles a ON a.id = at.article_id
    WHERE a.updated_at >= ?
    ORDER BY at.score DESC
  `).all(cutoff) as Array<{ article_id: string; name: string }>;

  const entitiesByArticle = new Map<string, string[]>();
  for (const row of entityRows) {
    if (!entitiesByArticle.has(row.article_id)) {
      entitiesByArticle.set(row.article_id, []);
    }
    const list = entitiesByArticle.get(row.article_id)!;
    if (list.length < 8 && !list.includes(row.name)) {
      list.push(row.name);
    }
  }
  const themesByArticle = new Map<string, string[]>();
  for (const row of themeRows) {
    if (!themesByArticle.has(row.article_id)) {
      themesByArticle.set(row.article_id, []);
    }
    const list = themesByArticle.get(row.article_id)!;
    if (list.length < 6 && !list.includes(row.name)) {
      list.push(row.name);
    }
  }

  const clusters = new Map<string, StorylineSeedArticle[]>();
  const metadata = new Map<string, { category: string; anchorEntity: string | null; anchorTheme: string | null }>();

  for (const article of articles) {
    const entities = entitiesByArticle.get(article.id) ?? [];
    const themes = themesByArticle.get(article.id) ?? [];
    const anchorEntity = entities[0] ?? null;
    const anchorTheme = themes[0] ?? null;
    const category = article.primary_category || 'General';
    const clusterKey = `${category}::${anchorEntity ?? anchorTheme ?? normalizeStorylineTitle(article.title)}`;

    if (!clusters.has(clusterKey)) {
      clusters.set(clusterKey, []);
      metadata.set(clusterKey, { category, anchorEntity, anchorTheme });
    }
    clusters.get(clusterKey)!.push(article);
  }

  return Array.from(clusters.entries())
    .map(([clusterKey, clusterArticles]) => {
      const info = metadata.get(clusterKey)!;
      const sortedArticles = [...clusterArticles].sort(
        (a, b) => (b.importance_score ?? 0) - (a.importance_score ?? 0)
      );
      const sources = Array.from(new Set(sortedArticles.map((article) => article.source_title).filter(Boolean)));
      const articleIds = sortedArticles.map((article) => article.id);
      const dominantEntities = aggregateDominantEntities(db, articleIds, 6);
      const dominantThemes = aggregateDominantThemes(db, articleIds, 5);
      const dominantLocations = aggregateDominantLocations(db, articleIds, 4);

      return {
        id: clusterKey,
        title: info.anchorEntity
          ? `${info.anchorEntity} / ${info.category}`
          : info.anchorTheme
            ? `${info.anchorTheme} / ${info.category}`
          : `${info.category}: ${sortedArticles[0]?.title ?? 'Storyline'}`,
        category: info.category,
        anchorEntity: info.anchorEntity,
        anchorTheme: info.anchorTheme,
        storyCount: sortedArticles.length,
        sourceCount: sources.length,
        totalImportance: sortedArticles.reduce((sum, article) => sum + (article.importance_score ?? 0), 0),
        articles: sortedArticles.slice(0, 5).map((article) => ({
          id: article.id,
          title: article.title,
          url: article.canonical_url,
          publishedAt: article.published_at,
          sourceTitle: article.source_title,
          importanceScore: article.importance_score ?? 0,
        })),
        entities: dominantEntities,
        themes: dominantThemes,
        locations: dominantLocations,
      };
    })
    .sort((a, b) => {
      if (b.storyCount !== a.storyCount) return b.storyCount - a.storyCount;
      if (b.sourceCount !== a.sourceCount) return b.sourceCount - a.sourceCount;
      return b.totalImportance - a.totalImportance;
    })
    .slice(0, 10);
}

function aggregateDominantEntities(db: ReturnType<typeof getDb>, articleIds: string[], limit: number) {
  if (articleIds.length === 0) return [] as Array<{ name: string; mentions: number }>;
  const placeholders = articleIds.map(() => '?').join(', ');
  return db.prepare(`
    SELECT e.name, SUM(ae.mention_count) AS mentions
    FROM article_entities ae
    JOIN entities e ON e.id = ae.entity_id
    WHERE ae.article_id IN (${placeholders})
    GROUP BY e.id
    ORDER BY mentions DESC
    LIMIT ?
  `).all(...articleIds, limit) as Array<{ name: string; mentions: number }>;
}

function aggregateDominantThemes(db: ReturnType<typeof getDb>, articleIds: string[], limit: number) {
  if (articleIds.length === 0) return [] as Array<{ name: string; score: number }>;
  const placeholders = articleIds.map(() => '?').join(', ');
  return db.prepare(`
    SELECT t.name, SUM(at.score) AS score
    FROM article_themes at
    JOIN themes t ON t.id = at.theme_id
    WHERE at.article_id IN (${placeholders})
    GROUP BY t.id
    ORDER BY score DESC
    LIMIT ?
  `).all(...articleIds, limit) as Array<{ name: string; score: number }>;
}

function aggregateDominantLocations(db: ReturnType<typeof getDb>, articleIds: string[], limit: number) {
  if (articleIds.length === 0) return [] as Array<{ name: string; mentions: number }>;
  const placeholders = articleIds.map(() => '?').join(', ');
  return db.prepare(`
    SELECT l.name, SUM(al.mention_count) AS mentions
    FROM article_locations al
    JOIN locations l ON l.id = al.location_id
    WHERE al.article_id IN (${placeholders})
    GROUP BY l.id
    ORDER BY mentions DESC
    LIMIT ?
  `).all(...articleIds, limit) as Array<{ name: string; mentions: number }>;
}

function normalizeStorylineTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 4)
    .slice(0, 4)
    .join(' ');
}

function buildPriorityReasons(input: {
  ageHours: number;
  primaryCategory: string | null;
  entityCount: number;
  themeCount: number;
  locationCount: number;
  importanceScore: number;
}) {
  const reasons: string[] = [];

  if (input.ageHours <= 6) {
    reasons.push('fresh development');
  }
  if (input.importanceScore >= 90) {
    reasons.push('high article importance');
  }
  if (input.primaryCategory && input.primaryCategory !== 'General') {
    reasons.push(`${input.primaryCategory} signal`);
  }
  if (input.entityCount >= 3) {
    reasons.push('multiple key entities');
  }
  if (input.themeCount >= 3) {
    reasons.push('strong theme match');
  }
  if (input.locationCount > 0) {
    reasons.push('location-linked story');
  }

  return reasons.slice(0, 3);
}

function computePriorityInterestBonus(input: {
  title: string;
  summary: string | null;
  sourceTitle: string | null;
  category: string | null;
  tags: ArticleTag[];
}) {
  let score = 0;
  const normalizedTags = new Set(input.tags.map((tag) => tag.name.toLowerCase()));
  if (input.category) normalizedTags.add(input.category.toLowerCase());

  const titleSummaryText = `${input.title}\n${input.summary ?? ''}\n${input.sourceTitle ?? ''}`;
  let lexicalInterestScore = 0;
  for (const [pattern, bonus] of PRIORITY_INTEREST_PATTERNS) {
    if (pattern.test(titleSummaryText)) lexicalInterestScore += bonus;
  }

  for (const tag of normalizedTags) {
    const tagBonus = PRIORITY_INTEREST_TAGS.get(tag) ?? 0;
    if (tagBonus > 0 && lexicalInterestScore > 0) {
      score += tagBonus;
    }
    score += LOWER_PRIORITY_NEWS_TAGS.get(tag) ?? 0;
  }

  score += lexicalInterestScore;

  const hasTechOrBusinessSignal = lexicalInterestScore > 0;

  if (!hasTechOrBusinessSignal && GENERIC_POLITICS_PATTERN.test(titleSummaryText)) {
    score -= 24;
  }

  if (!hasTechOrBusinessSignal && (normalizedTags.has('world') || normalizedTags.has('politics'))) {
    score -= 18;
  }

  return Math.max(-42, Math.min(90, score));
}

function buildArticleTags(input: {
  category: string;
  sourceTitle: string | null;
  themes: Array<{ name: string; score: number }>;
  locations: Array<{ name: string; mentionCount: number; locationType: 'country' | 'city' }>;
  entities: Array<{ name: string; mentionCount: number }>;
}) {
  const tags = new Map<string, ArticleTag>();
  const addTag = (tag: ArticleTag) => {
    const normalized = normalizeTagName(tag.name);
    if (!normalized) return;
    const existing = tags.get(normalized.toLowerCase());
    if (!existing || tag.score > existing.score) {
      tags.set(normalized.toLowerCase(), {
        ...tag,
        name: normalized,
        score: Number(tag.score.toFixed(2)),
      });
    }
  };

  if (input.category && input.category !== 'General') {
    addTag({ name: input.category, type: 'category', score: 80 });
  }

  for (const theme of input.themes) {
    if (theme.name === input.category) continue;
    addTag({
      name: theme.name,
      type: 'topic',
      score: 60 + Math.min(30, theme.score * 4),
    });
  }

  for (const location of input.locations) {
    addTag({
      name: location.name === 'United States' ? 'USA' : location.name,
      type: 'geo',
      score: (location.locationType === 'country' ? 58 : 48) + Math.min(20, location.mentionCount * 4),
    });
  }

  for (const entity of input.entities.slice(0, 8)) {
    addTag({
      name: entity.name,
      type: 'entity',
      score: 35 + Math.min(25, entity.mentionCount * 5),
    });
  }

  if (input.sourceTitle) {
    addTag({
      name: input.sourceTitle,
      type: 'source',
      score: 20,
    });
  }

  return Array.from(tags.values())
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 24);
}

function normalizeTagName(name: string) {
  return name
    .replace(/\s+/g, ' ')
    .replace(/^the\s+/i, '')
    .trim()
    .slice(0, 48);
}

function getDisplayTags(tags: ArticleTag[], category: string | null, sourceTitle: string | null) {
  const displayTypes: ArticleTagType[] = ['category', 'topic', 'geo'];
  const sourceNormalized = sourceTitle?.trim().toLowerCase();
  const names = tags
    .filter((tag) => displayTypes.includes(tag.type))
    .filter((tag) => isUsefulDisplayTag(tag.name))
    .filter((tag) => tag.name.trim().toLowerCase() !== sourceNormalized)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((tag) => tag.name);

  return Array.from(new Set([
    ...(category && category !== 'General' ? [category] : []),
    ...names,
  ])).slice(0, 8);
}

function isUsefulDisplayTag(name: string) {
  const normalized = name.trim().toLowerCase();
  if (normalized.length < 2) return false;
  if (normalized.includes('url')) return false;
  if (normalized.includes('http')) return false;
  if (normalized.includes('rss')) return false;
  if (normalized.includes('feed')) return false;
  if (normalized.includes('comments')) return false;
  if (normalized.includes(' views')) return false;
  if (normalized.includes(' likes')) return false;
  if (normalized.includes(' rt')) return false;
  if (normalized.split(/\s+/).length > 4) return false;
  return true;
}

function parseArticleTags(tagsJson: string | null): ArticleTag[] {
  if (!tagsJson) return [];

  try {
    const parsed = JSON.parse(tagsJson);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((tag): ArticleTag | null => {
        if (typeof tag === 'string' && tag.trim().length > 0) {
          const name = normalizeTagName(tag);
          const normalized = name.toLowerCase();
          return {
            name,
            type: LEGACY_DISPLAY_TAGS.has(normalized) || /^[A-Z]{2,5}$/.test(name) ? 'topic' : 'entity',
            score: LEGACY_DISPLAY_TAGS.has(normalized) ? 45 : 25,
          };
        }
        if (
          tag &&
          typeof tag === 'object' &&
          typeof tag.name === 'string' &&
          typeof tag.type === 'string' &&
          ['category', 'topic', 'geo', 'entity', 'source'].includes(tag.type)
        ) {
          return {
            name: normalizeTagName(tag.name),
            type: tag.type as ArticleTagType,
            score: typeof tag.score === 'number' ? tag.score : 40,
          };
        }
        return null;
      })
      .filter((tag): tag is ArticleTag => Boolean(tag?.name))
      .slice(0, 16);
  } catch {
    return [];
  }
}

function hashArticle(article: Article) {
  return crypto
    .createHash('sha256')
    .update(`${article.title}|${article.link}|${article.pubDate}|${article.contentSnippet || ''}`)
    .digest('hex');
}

function computeImportance(article: Article, locationCount: number) {
  const recencyHours = Math.max(
    1,
    (Date.now() - new Date(article.pubDate || Date.now()).getTime()) / (1000 * 60 * 60)
  );
  const recencyScore = Math.max(0, 100 - recencyHours);
  const contentScore = Math.min(40, (article.contentSnippet?.length || 0) / 8);
  const locationScore = Math.min(20, locationCount * 4);
  return Number((recencyScore + contentScore + locationScore).toFixed(2));
}

function rebuildTrendSnapshots() {
  const db = getDb();
  const now = new Date().toISOString();
  const snapshotDate = currentSnapshotDate();
  const windows = [1, 7];
  const deleteStatement = db.prepare(`
    DELETE FROM trend_snapshots
    WHERE snapshot_date = ? AND window_type = ?
  `);
  const insertStatement = db.prepare(`
    INSERT INTO trend_snapshots (
      id, snapshot_date, window_type, metric_type, metric_key, value, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const windowDays of windows) {
    const windowType = `${windowDays}d`;
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    deleteStatement.run(snapshotDate, windowType);

    const categoryRows = db.prepare(`
      SELECT aa.primary_category AS metric_key, COUNT(*) AS value
      FROM article_analysis aa
      JOIN articles a ON a.id = aa.article_id
      WHERE a.updated_at >= ?
      GROUP BY aa.primary_category
    `).all(cutoff) as Array<{ metric_key: string; value: number }>;

    const locationRows = db.prepare(`
      SELECT l.name AS metric_key, SUM(al.mention_count) AS value
      FROM article_locations al
      JOIN locations l ON l.id = al.location_id
      JOIN articles a ON a.id = al.article_id
      WHERE a.updated_at >= ?
      GROUP BY l.id
      ORDER BY value DESC
      LIMIT 20
    `).all(cutoff) as Array<{ metric_key: string; value: number }>;

    const entityRows = db.prepare(`
      SELECT e.name AS metric_key, SUM(ae.mention_count) AS value
      FROM article_entities ae
      JOIN entities e ON e.id = ae.entity_id
      JOIN articles a ON a.id = ae.article_id
      WHERE a.updated_at >= ?
      GROUP BY e.id
      ORDER BY value DESC
      LIMIT 20
    `).all(cutoff) as Array<{ metric_key: string; value: number }>;
    const themeRows = db.prepare(`
      SELECT t.name AS metric_key, SUM(at.score) AS value
      FROM article_themes at
      JOIN themes t ON t.id = at.theme_id
      JOIN articles a ON a.id = at.article_id
      WHERE a.updated_at >= ?
      GROUP BY t.id
      ORDER BY value DESC
      LIMIT 20
    `).all(cutoff) as Array<{ metric_key: string; value: number }>;

    for (const row of categoryRows) {
      insertStatement.run(generateSnapshotId(snapshotDate, windowType, 'category_count', row.metric_key), snapshotDate, windowType, 'category_count', row.metric_key, row.value, now);
    }

    for (const row of locationRows) {
      insertStatement.run(generateSnapshotId(snapshotDate, windowType, 'location_mentions', row.metric_key), snapshotDate, windowType, 'location_mentions', row.metric_key, row.value, now);
    }

    for (const row of entityRows) {
      insertStatement.run(generateSnapshotId(snapshotDate, windowType, 'entity_mentions', row.metric_key), snapshotDate, windowType, 'entity_mentions', row.metric_key, row.value, now);
    }

    for (const row of themeRows) {
      insertStatement.run(generateSnapshotId(snapshotDate, windowType, 'theme_mentions', row.metric_key), snapshotDate, windowType, 'theme_mentions', row.metric_key, row.value, now);
    }
  }
}

function currentSnapshotDate() {
  return new Date().toISOString().slice(0, 10);
}

function generateSnapshotId(snapshotDate: string, windowType: string, metricType: string, metricKey: string) {
  return `${snapshotDate}:${windowType}:${metricType}:${metricKey}`;
}

export function getTrendSeries(days = 7, lookbackDays = 14) {
  const db = getDb();
  const windowType = `${days}d`;
  const snapshotCutoff = new Date(Date.now() - (lookbackDays - 1) * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const categoryKeys = db.prepare(`
    SELECT metric_key, SUM(value) AS total
    FROM trend_snapshots
    WHERE snapshot_date >= ? AND window_type = ? AND metric_type = 'category_count'
    GROUP BY metric_key
    ORDER BY total DESC
    LIMIT 5
  `).all(snapshotCutoff, windowType) as Array<{ metric_key: string; total: number }>;

  const locationKeys = db.prepare(`
    SELECT metric_key, SUM(value) AS total
    FROM trend_snapshots
    WHERE snapshot_date >= ? AND window_type = ? AND metric_type = 'location_mentions'
    GROUP BY metric_key
    ORDER BY total DESC
    LIMIT 5
  `).all(snapshotCutoff, windowType) as Array<{ metric_key: string; total: number }>;

  const entityKeys = db.prepare(`
    SELECT metric_key, SUM(value) AS total
    FROM trend_snapshots
    WHERE snapshot_date >= ? AND window_type = ? AND metric_type = 'entity_mentions'
    GROUP BY metric_key
    ORDER BY total DESC
    LIMIT 5
  `).all(snapshotCutoff, windowType) as Array<{ metric_key: string; total: number }>;
  const themeKeys = db.prepare(`
    SELECT metric_key, SUM(value) AS total
    FROM trend_snapshots
    WHERE snapshot_date >= ? AND window_type = ? AND metric_type = 'theme_mentions'
    GROUP BY metric_key
    ORDER BY total DESC
    LIMIT 5
  `).all(snapshotCutoff, windowType) as Array<{ metric_key: string; total: number }>;

  return {
    windowType,
    categories: buildSeries(db, snapshotCutoff, windowType, 'category_count', categoryKeys.map((row) => row.metric_key)),
    locations: buildSeries(db, snapshotCutoff, windowType, 'location_mentions', locationKeys.map((row) => row.metric_key)),
    entities: buildSeries(db, snapshotCutoff, windowType, 'entity_mentions', entityKeys.map((row) => row.metric_key)),
    themes: buildSeries(db, snapshotCutoff, windowType, 'theme_mentions', themeKeys.map((row) => row.metric_key)),
  };
}

function buildSeries(
  db: ReturnType<typeof getDb>,
  snapshotCutoff: string,
  windowType: string,
  metricType: string,
  metricKeys: string[]
) {
  if (metricKeys.length === 0) {
    return { dates: [] as string[], series: [] as Array<{ label: string; values: number[] }> };
  }

  const rows = db.prepare(`
    SELECT snapshot_date, metric_key, value
    FROM trend_snapshots
    WHERE snapshot_date >= ?
      AND window_type = ?
      AND metric_type = ?
      AND metric_key IN (${metricKeys.map(() => '?').join(', ')})
    ORDER BY snapshot_date ASC
  `).all(snapshotCutoff, windowType, metricType, ...metricKeys) as TrendSeriesRow[];

  const dateSet = new Set<string>();
  const byMetric = new Map<string, Map<string, number>>();

  for (const row of rows) {
    dateSet.add(row.snapshot_date);
    if (!byMetric.has(row.metric_key)) {
      byMetric.set(row.metric_key, new Map<string, number>());
    }
    byMetric.get(row.metric_key)!.set(row.snapshot_date, row.value);
  }

  const dates = Array.from(dateSet.values()).sort();
  return {
    dates,
    series: metricKeys.map((key) => ({
      label: key,
      values: dates.map((date) => byMetric.get(key)?.get(date) ?? 0),
    })),
  };
}
