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
  CREATE TABLE article_entities (
    article_id TEXT, entity_id TEXT, mention_count INTEGER, weight REAL,
    salience REAL, sentiment REAL, snippet TEXT, PRIMARY KEY (article_id, entity_id)
  );
`);
vi.mock('./db', () => ({ getDb: () => db }));

const generateText = vi.fn();
vi.mock('@/lib/ai/providers', () => ({ generateText: (...a: unknown[]) => generateText(...a) }));
vi.mock('./settings-repository', () => ({
  getServerAISettings: () => ({
    enabled: true, provider: 'ollama', model: 'qwen2.5:7b', baseUrl: undefined, apiKey: undefined, embedModel: 'nomic-embed-text',
  }),
}));

import { regenerateDirtyEntitySummaries } from './entities-repository';

beforeEach(() => {
  db.exec('DELETE FROM entities; DELETE FROM article_entities;');
  generateText.mockReset();
});

describe('regenerateDirtyEntitySummaries', () => {
  it('summarizes entities at/above the dirty threshold and clears the counter', async () => {
    db.prepare(`INSERT INTO entities (id,name,normalized_name,entity_type,created_at,updated_at,mention_count,summary_dirty_count)
      VALUES ('e1','OpenAI','openai','organization','t','t',5,3)`).run();
    db.prepare(`INSERT INTO article_entities (article_id,entity_id,mention_count,weight,salience,snippet)
      VALUES ('a1','e1',1,0.9,0.9,'OpenAI shipped a model')`).run();
    generateText.mockResolvedValue({ text: 'OpenAI is an AI lab in the news for model launches.' });

    const count = await regenerateDirtyEntitySummaries(3);

    expect(count).toBe(1);
    const row = db.prepare("SELECT summary, summary_dirty_count FROM entities WHERE id='e1'").get() as Record<string, unknown>;
    expect(row.summary).toContain('OpenAI');
    expect(row.summary_dirty_count).toBe(0);
  });

  it('skips entities below the threshold', async () => {
    db.prepare(`INSERT INTO entities (id,name,normalized_name,entity_type,created_at,updated_at,mention_count,summary_dirty_count)
      VALUES ('e2','Acme','acme','organization','t','t',1,1)`).run();
    const count = await regenerateDirtyEntitySummaries(3);
    expect(count).toBe(0);
    expect(generateText).not.toHaveBeenCalled();
  });
});
