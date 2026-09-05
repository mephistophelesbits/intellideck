import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));

// entity-aliases.ts imports ./db (for mergeAliasedEntities), so mock it at load.
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE entities (id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL, mention_count INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE article_entities (article_id TEXT NOT NULL, entity_id TEXT NOT NULL, PRIMARY KEY(article_id, entity_id));
`);
vi.mock('./db', () => ({ getDb: () => db }));

import { canonicalizeEntity, mergeAliasedEntities } from './entity-aliases';

describe('canonicalizeEntity', () => {
  it('maps an English alias to the canonical name + type', () => {
    expect(canonicalizeEntity('the Fed', 'org')).toEqual({ name: 'Federal Reserve', type: 'org' });
  });

  it('maps a Chinese alias to the same canonical entity', () => {
    expect(canonicalizeEntity('美联储', 'org')).toEqual({ name: 'Federal Reserve', type: 'org' });
  });

  it('corrects the type from the alias map (White House is an org, not a person)', () => {
    expect(canonicalizeEntity('白宫', 'person')).toEqual({ name: 'White House', type: 'org' });
  });

  it('returns unknown names unchanged', () => {
    expect(canonicalizeEntity('Acme Widgets', 'org')).toEqual({ name: 'Acme Widgets', type: 'org' });
  });
});

describe('mergeAliasedEntities', () => {
  beforeEach(() => { db.exec('DELETE FROM entities; DELETE FROM article_entities;'); });

  it('merges fragmented rows onto one canonical row and repoints links (conflict-safe)', () => {
    db.exec(`
      INSERT INTO entities (id, name, normalized_name, entity_type, mention_count) VALUES
        ('fed','Fed','fed','organization',3),
        ('cn','美联储','美联储','organization',2);
      INSERT INTO article_entities (article_id, entity_id) VALUES
        ('a1','fed'), ('a2','cn'), ('a3','fed'), ('a3','cn');
    `);
    const merged = mergeAliasedEntities();
    expect(merged).toBeGreaterThanOrEqual(1);

    const rows = db.prepare("SELECT normalized_name FROM entities WHERE normalized_name IN ('fed','美联储','federal reserve')").all() as Array<{ normalized_name: string }>;
    expect(rows.map((r) => r.normalized_name).sort()).toEqual(['federal reserve']);

    const survivorId = (db.prepare("SELECT id FROM entities WHERE normalized_name='federal reserve'").get() as { id: string }).id;
    const links = db.prepare('SELECT DISTINCT entity_id FROM article_entities').all() as Array<{ entity_id: string }>;
    expect(links).toEqual([{ entity_id: survivorId }]);
    const a3 = db.prepare("SELECT COUNT(*) AS c FROM article_entities WHERE article_id='a3'").get() as { c: number };
    expect(a3.c).toBe(1);
  });
});
