import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE search_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    label_color TEXT NOT NULL DEFAULT '#f97316',
    query TEXT NOT NULL,
    keywords_json TEXT NOT NULL,
    settings_json TEXT NOT NULL DEFAULT '{"matchMode":"or","excludeKeywords":[]}',
    order_index INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_run_at TEXT
  );
  CREATE TABLE articles (
    id TEXT PRIMARY KEY,
    source_url TEXT NOT NULL,
    source_title TEXT,
    canonical_url TEXT NOT NULL,
    title TEXT NOT NULL,
    published_at TEXT,
    content_snippet TEXT,
    raw_content TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE article_analysis (
    article_id TEXT PRIMARY KEY,
    primary_category TEXT,
    importance_score REAL
  );
  CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE article_entities (
    article_id TEXT NOT NULL,
    entity_id TEXT NOT NULL
  );
  CREATE TABLE themes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category_hint TEXT
  );
  CREATE TABLE article_themes (
    article_id TEXT NOT NULL,
    theme_id TEXT NOT NULL,
    score REAL
  );
`);

vi.mock('./db', () => ({ getDb: () => db }));

import { runArticleSearch } from './search-repository';

function insertArticle(id: string, title: string, snippet = '') {
  db.prepare(`
    INSERT INTO articles (id, source_url, source_title, canonical_url, title, published_at, content_snippet, raw_content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, `https://example.com/${id}`, 'Reuters', `https://example.com/${id}`, title, '2026-07-01T00:00:00.000Z', snippet, null, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
}

describe('runArticleSearch', () => {
  beforeEach(() => {
    db.exec('DELETE FROM articles; DELETE FROM search_rules;');
  });

  it('runs the LIKE query end-to-end without a SQLite ESCAPE error', () => {
    insertArticle('a1', 'Nvidia chips surge on export news');
    insertArticle('a2', 'Unrelated sports recap');

    const { results } = runArticleSearch('nvidia');

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('a1');
  });

  it('treats literal % and _ in a keyword as literal characters, not SQL wildcards', () => {
    insertArticle('literal', 'Quarterly results: 50%_off promo drives Q3 revenue');
    insertArticle('decoy', 'Totally unrelated headline about weather');

    const { results } = runArticleSearch('50%_off');

    expect(results.map((r) => r.id)).toEqual(['literal']);
  });

  it('exclude keywords containing % or _ only exclude literal matches, not everything', () => {
    insertArticle('keep', 'Nvidia earnings beat expectations');
    insertArticle('exclude-me', 'Nvidia 50%_off clearance sale');

    const { results } = runArticleSearch('nvidia', { settings: { matchMode: 'or', excludeKeywords: ['50%_off'] } });

    expect(results.map((r) => r.id)).toEqual(['keep']);
  });
});
