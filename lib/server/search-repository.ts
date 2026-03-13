import 'server-only';

import crypto from 'crypto';
import { getDb } from './db';

export type SavedSearchRule = {
  id: string;
  name: string;
  query: string;
  keywords: string[];
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
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
};

type SearchRow = {
  id: string;
  title: string;
  canonical_url: string;
  published_at: string | null;
  source_title: string | null;
  source_url: string | null;
  content_snippet: string | null;
  raw_content: string | null;
  primary_category: string | null;
  importance_score: number | null;
  relevance: number;
};

export function parseSearchKeywords(query: string) {
  return Array.from(
    new Set(
      query
        .split(',')
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 12)
    )
  );
}

export function getSearchRules(): SavedSearchRule[] {
  const db = getDb();
  return db.prepare(`
    SELECT id, name, query, keywords_json, created_at, updated_at, last_run_at
    FROM search_rules
    ORDER BY updated_at DESC, created_at DESC
  `).all().map((row) => {
    const data = row as {
      id: string;
      name: string;
      query: string;
      keywords_json: string;
      created_at: string;
      updated_at: string;
      last_run_at: string | null;
    };

    return {
      id: data.id,
      name: data.name,
      query: data.query,
      keywords: JSON.parse(data.keywords_json) as string[],
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      lastRunAt: data.last_run_at,
    };
  });
}

export function saveSearchRule(input: { id?: string; name?: string; query: string }) {
  const keywords = parseSearchKeywords(input.query);
  if (keywords.length === 0) {
    throw new Error('Search query must contain at least one keyword');
  }

  const db = getDb();
  const now = new Date().toISOString();
  const query = keywords.join(', ');
  const id = input.id ?? crypto.randomUUID();
  const name = input.name?.trim() || keywords.slice(0, 3).join(', ');

  db.prepare(`
    INSERT INTO search_rules (id, name, query, keywords_json, created_at, updated_at, last_run_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      query = excluded.query,
      keywords_json = excluded.keywords_json,
      updated_at = excluded.updated_at
  `).run(id, name, query, JSON.stringify(keywords), now, now, null);

  return getSearchRules();
}

export function deleteSearchRule(ruleId: string) {
  const db = getDb();
  db.prepare(`DELETE FROM search_rules WHERE id = ?`).run(ruleId);
  return getSearchRules();
}

export function runArticleSearch(query: string): { keywords: string[]; results: SearchResult[] } {
  const keywords = parseSearchKeywords(query);
  if (keywords.length === 0) {
    return { keywords: [], results: [] };
  }

  const db = getDb();
  const { sql, params } = buildSearchQuery(keywords);
  const rows = db.prepare(sql).all(...params) as SearchRow[];
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE search_rules
    SET last_run_at = ?, updated_at = CASE WHEN last_run_at IS NULL THEN updated_at ELSE updated_at END
    WHERE query = ?
  `).run(now, keywords.join(', '));

  return {
    keywords,
    results: rows.map((row) => ({
      id: row.id,
      title: row.title,
      url: row.canonical_url,
      publishedAt: row.published_at,
      sourceTitle: row.source_title,
      sourceUrl: row.source_url,
      contentSnippet: row.content_snippet,
      rawContent: row.raw_content,
      category: row.primary_category,
      importanceScore: Number((row.importance_score ?? 0).toFixed(2)),
      matchedTerms: keywords.filter((keyword) => matchesKeyword(row, keyword)),
      relevance: Number(row.relevance.toFixed(2)),
    })),
  };
}

function buildSearchQuery(keywords: string[]) {
  const whereParts: string[] = [];
  const scoreParts: string[] = [];
  const scoreParams: string[] = [];
  const whereParams: string[] = [];

  for (const keyword of keywords) {
    const like = `%${keyword}%`;

    whereParts.push(`(
      lower(a.title) LIKE ?
      OR lower(COALESCE(a.content_snippet, '')) LIKE ?
      OR lower(COALESCE(a.raw_content, '')) LIKE ?
      OR lower(COALESCE(a.source_title, '')) LIKE ?
      OR EXISTS (
        SELECT 1
        FROM article_themes at
        JOIN themes t ON t.id = at.theme_id
        WHERE at.article_id = a.id AND lower(t.name) LIKE ?
      )
      OR EXISTS (
        SELECT 1
        FROM article_entities ae
        JOIN entities e ON e.id = ae.entity_id
        WHERE ae.article_id = a.id AND lower(e.name) LIKE ?
      )
    )`);

    scoreParts.push(`(
      CASE WHEN lower(a.title) LIKE ? THEN 14 ELSE 0 END +
      CASE WHEN lower(COALESCE(a.content_snippet, '')) LIKE ? THEN 5 ELSE 0 END +
      CASE WHEN lower(COALESCE(a.raw_content, '')) LIKE ? THEN 2 ELSE 0 END +
      CASE WHEN lower(COALESCE(a.source_title, '')) LIKE ? THEN 3 ELSE 0 END +
      CASE WHEN EXISTS (
        SELECT 1
        FROM article_themes at
        JOIN themes t ON t.id = at.theme_id
        WHERE at.article_id = a.id AND lower(t.name) LIKE ?
      ) THEN 6 ELSE 0 END +
      CASE WHEN EXISTS (
        SELECT 1
        FROM article_entities ae
        JOIN entities e ON e.id = ae.entity_id
        WHERE ae.article_id = a.id AND lower(e.name) LIKE ?
      ) THEN 7 ELSE 0 END
    )`);

    scoreParams.push(like, like, like, like, like, like);
    whereParams.push(like, like, like, like, like, like);
  }

  const sql = `
    SELECT
      a.id,
      a.title,
      a.canonical_url,
      a.published_at,
      a.source_title,
      a.source_url,
      a.content_snippet,
      a.raw_content,
      aa.primary_category,
      aa.importance_score,
      (${scoreParts.join(' + ')}) + COALESCE(aa.importance_score, 0) AS relevance
    FROM articles a
    LEFT JOIN article_analysis aa ON aa.article_id = a.id
    WHERE ${whereParts.join(' OR ')}
    ORDER BY relevance DESC, COALESCE(aa.importance_score, 0) DESC, a.published_at DESC, a.updated_at DESC
    LIMIT 60
  `;

  return { sql, params: [...scoreParams, ...whereParams] };
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
