import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    aliases TEXT,
    summary TEXT,
    salience REAL NOT NULL DEFAULT 0,
    mention_count INTEGER NOT NULL DEFAULT 0,
    first_seen TEXT,
    last_seen TEXT,
    summary_dirty_count INTEGER NOT NULL DEFAULT 0,
    summary_updated_at TEXT
  );
  CREATE TABLE article_entities (
    article_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    mention_count INTEGER NOT NULL,
    weight REAL NOT NULL,
    salience REAL,
    sentiment REAL,
    snippet TEXT,
    PRIMARY KEY (article_id, entity_id)
  );
`);

vi.mock('./db', () => ({ getDb: () => db }));

import { upsertEntitiesForArticle, getEntityById } from './entities-repository';

describe('entities-repository', () => {
  beforeEach(() => {
    db.exec('DELETE FROM entities; DELETE FROM article_entities;');
  });

  it('creates a new entity with first_seen/last_seen and mention_count 1', () => {
    upsertEntitiesForArticle('art-1', '2026-06-14T00:00:00.000Z', [
      { name: 'OpenAI', type: 'org', salience: 0.9, snippet: 's' },
    ]);
    const all = db.prepare('SELECT * FROM entities').all() as Array<Record<string, unknown>>;
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('OpenAI');
    expect(all[0].mention_count).toBe(1);
    expect(all[0].first_seen).toBe('2026-06-14T00:00:00.000Z');
    expect(all[0].last_seen).toBe('2026-06-14T00:00:00.000Z');
  });

  it('bumps mention_count and last_seen on a second article, keeping first_seen', () => {
    upsertEntitiesForArticle('art-1', '2026-06-14T00:00:00.000Z', [
      { name: 'OpenAI', type: 'org', salience: 0.9, snippet: 's1' },
    ]);
    upsertEntitiesForArticle('art-2', '2026-06-15T00:00:00.000Z', [
      { name: 'OpenAI', type: 'org', salience: 0.4, snippet: 's2' },
    ]);
    const row = db.prepare("SELECT * FROM entities WHERE normalized_name = 'openai'").get() as Record<string, unknown>;
    expect(row.mention_count).toBe(2);
    expect(row.first_seen).toBe('2026-06-14T00:00:00.000Z');
    expect(row.last_seen).toBe('2026-06-15T00:00:00.000Z');
    expect(row.summary_dirty_count).toBe(2);
  });

  it('records the per-mention salience and snippet in article_entities', () => {
    upsertEntitiesForArticle('art-1', '2026-06-14T00:00:00.000Z', [
      { name: 'NVIDIA', type: 'org', salience: 0.8, snippet: 'NVIDIA earnings' },
    ]);
    const link = db.prepare('SELECT * FROM article_entities').get() as Record<string, unknown>;
    expect(link.salience).toBeCloseTo(0.8);
    expect(link.snippet).toBe('NVIDIA earnings');
  });

  it("replaces an article's prior entity links on re-processing", () => {
    upsertEntitiesForArticle('art-1', '2026-06-14T00:00:00.000Z', [
      { name: 'Apple', type: 'org', salience: 0.5, snippet: 's' },
    ]);
    upsertEntitiesForArticle('art-1', '2026-06-14T00:00:00.000Z', [
      { name: 'Google', type: 'org', salience: 0.5, snippet: 's' },
    ]);
    const links = db.prepare('SELECT entity_id FROM article_entities WHERE article_id = ?').all('art-1');
    expect(links).toHaveLength(1);
    const entity = getEntityById((links[0] as { entity_id: string }).entity_id);
    expect(entity?.name).toBe('Google');
    expect(getEntityById((links[0] as { entity_id: string }).entity_id)?.mentionCount).toBe(1);
    const apple = db.prepare("SELECT mention_count AS mentionCount FROM entities WHERE normalized_name = 'apple'").get() as { mentionCount: number } | undefined;
    expect(apple).toBeUndefined();
  });
});
