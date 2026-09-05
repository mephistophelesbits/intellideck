import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));
vi.mock('./settings-repository', () => ({ getServerAISettings: () => ({ enabled: false }) }));

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE articles (
    id TEXT PRIMARY KEY,
    source_url TEXT NOT NULL,
    source_title TEXT,
    canonical_url TEXT NOT NULL,
    title TEXT NOT NULL,
    published_at TEXT,
    created_at TEXT NOT NULL,
    content_snippet TEXT,
    raw_content TEXT,
    scraped_text TEXT,
    language TEXT
  );
  CREATE TABLE article_analysis (
    article_id TEXT PRIMARY KEY,
    primary_category TEXT,
    importance_score REAL
  );
  CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    entity_type TEXT
  );
  CREATE TABLE article_entities (
    article_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    mention_count INTEGER,
    weight REAL,
    salience REAL
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

import { runSmartArticleSearch } from './smart-search';

function insertArticle(id: string, title: string, publishedAt: string) {
  db.prepare(`
    INSERT INTO articles (id, source_url, source_title, canonical_url, title, published_at, created_at, content_snippet, raw_content, scraped_text, language)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, `https://example.com/${id}`, 'Reuters', `https://example.com/${id}`, title, publishedAt, publishedAt, '', null, null, 'en');
}

describe('runSmartArticleSearch', () => {
  beforeEach(() => {
    db.exec('DELETE FROM articles;');
  });

  it('runs the LIKE query end-to-end without a SQLite ESCAPE error', async () => {
    insertArticle('a1', 'Nvidia export controls tighten', new Date().toISOString());
    const { results } = await runSmartArticleSearch('nvidia');
    expect(results.map((r) => r.id)).toEqual(['a1']);
  });

  it('a days filter narrows results instead of matching any recent article regardless of keyword', async () => {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
    insertArticle('recent-no-match', 'Totally unrelated weather roundup', now);
    insertArticle('old-match', 'Nvidia export controls tighten', old);

    const { results } = await runSmartArticleSearch('nvidia', { days: 7 });

    // Regression: this used to OR the date filter into the keyword conditions, so a recent
    // article with zero keyword overlap would still pass. It must be AND'd instead.
    expect(results.map((r) => r.id)).not.toContain('recent-no-match');
    expect(results.map((r) => r.id)).not.toContain('old-match');
    expect(results).toHaveLength(0);
  });

  it('literal % and _ in a keyword are treated as literal characters, not SQL wildcards', async () => {
    insertArticle('literal', 'Quarterly 50%_off promo drives revenue', new Date().toISOString());
    insertArticle('decoy', 'Unrelated headline', new Date().toISOString());

    const { results } = await runSmartArticleSearch('50%_off');

    expect(results.map((r) => r.id)).toEqual(['literal']);
  });

  it('matchMode "and" requires every include term to match', async () => {
    insertArticle('both', 'Nvidia China export controls', new Date().toISOString());
    insertArticle('nvidia-only', 'Nvidia earnings beat expectations', new Date().toISOString());

    const { results } = await runSmartArticleSearch('nvidia china', { matchMode: 'and' });

    expect(results.map((r) => r.id)).toEqual(['both']);
  });
});
