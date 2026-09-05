import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE entities (id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    salience REAL NOT NULL DEFAULT 0, mention_count INTEGER NOT NULL DEFAULT 0,
    first_seen TEXT, last_seen TEXT, summary TEXT, summary_dirty_count INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE article_entities (article_id TEXT NOT NULL, entity_id TEXT NOT NULL, mention_count INTEGER NOT NULL,
    weight REAL NOT NULL, salience REAL, sentiment REAL, snippet TEXT, PRIMARY KEY(article_id, entity_id));
`);
vi.mock('./db', () => ({ getDb: () => db }));
vi.mock('./settings-repository', () => ({ getServerAISettings: () => ({ enabled: true }) }));

import { upsertEntitiesForArticle } from './entities-repository';

beforeEach(() => { db.exec('DELETE FROM entities; DELETE FROM article_entities;'); });

describe('upsertEntitiesForArticle canonicalization', () => {
  it('collapses EN and CN variants into one canonical entity row', () => {
    upsertEntitiesForArticle('a1', 't', [{ name: 'the Fed', type: 'org', salience: 0.5, snippet: '' }]);
    upsertEntitiesForArticle('a2', 't', [{ name: '美联储', type: 'org', salience: 0.5, snippet: '' }]);
    const rows = db.prepare('SELECT name, normalized_name, mention_count FROM entities').all() as Array<{
      name: string;
      normalized_name: string;
      mention_count: number;
    }>;
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('Federal Reserve');
    expect(rows[0].mention_count).toBe(2); // bumped once per article
  });
});
