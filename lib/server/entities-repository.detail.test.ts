import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE entities (
    id TEXT PRIMARY KEY, name TEXT, normalized_name TEXT UNIQUE, entity_type TEXT,
    created_at TEXT, updated_at TEXT, aliases TEXT, summary TEXT,
    salience REAL DEFAULT 0, mention_count INTEGER DEFAULT 0,
    first_seen TEXT, last_seen TEXT, summary_dirty_count INTEGER DEFAULT 0, summary_updated_at TEXT
  );
  CREATE TABLE articles (
    id TEXT PRIMARY KEY, title TEXT, canonical_url TEXT, source_title TEXT,
    published_at TEXT, created_at TEXT
  );
  CREATE TABLE article_entities (
    article_id TEXT, entity_id TEXT, mention_count INTEGER, weight REAL,
    salience REAL, sentiment REAL, snippet TEXT, PRIMARY KEY (article_id, entity_id)
  );
`);
vi.mock('./db', () => ({ getDb: () => db }));
vi.mock('@/lib/ai/providers', () => ({ generateText: vi.fn() }));
vi.mock('./settings-repository', () => ({ getServerAISettings: () => ({ enabled: false }) }));

import { getEntityDetail } from './entities-repository';

beforeEach(() => {
  db.exec('DELETE FROM entities; DELETE FROM articles; DELETE FROM article_entities;');
});

describe('getEntityDetail', () => {
  it('returns the entity plus its articles ordered by date desc', () => {
    db.prepare(`INSERT INTO entities (id,name,normalized_name,entity_type,created_at,updated_at,summary,salience,mention_count,first_seen,last_seen)
      VALUES ('e1','OpenAI','openai','organization','t','t','A lab.',0.7,2,'2026-06-01T00:00:00.000Z','2026-06-10T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO articles (id,title,canonical_url,source_title,published_at,created_at)
      VALUES ('a1','Older','http://x/1','Src','2026-06-01T00:00:00.000Z','t')`).run();
    db.prepare(`INSERT INTO articles (id,title,canonical_url,source_title,published_at,created_at)
      VALUES ('a2','Newer','http://x/2','Src','2026-06-10T00:00:00.000Z','t')`).run();
    db.prepare(`INSERT INTO article_entities (article_id,entity_id,mention_count,weight,salience) VALUES ('a1','e1',1,0.5,0.5)`).run();
    db.prepare(`INSERT INTO article_entities (article_id,entity_id,mention_count,weight,salience) VALUES ('a2','e1',1,0.9,0.9)`).run();

    const detail = getEntityDetail('e1');
    expect(detail?.entity.name).toBe('OpenAI');
    expect(detail?.articles.map((a) => a.title)).toEqual(['Newer', 'Older']);
  });

  it('returns null for an unknown id', () => {
    expect(getEntityDetail('nope')).toBeNull();
  });
});
