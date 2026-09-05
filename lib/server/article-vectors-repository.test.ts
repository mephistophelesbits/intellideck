import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import * as sqliteVec from 'sqlite-vec';

vi.mock('server-only', () => ({}));

const db = new DatabaseSync(':memory:', { allowExtension: true });
db.enableLoadExtension(true);
db.loadExtension(sqliteVec.getLoadablePath());
db.enableLoadExtension(false);
db.exec(`
  CREATE VIRTUAL TABLE article_vectors USING vec0(
    article_id TEXT PRIMARY KEY,
    embedding FLOAT[3]
  );
`);

vi.mock('./db', () => ({ getDb: () => db }));

import { upsertArticleVector, findNearestArticles } from './article-vectors-repository';

describe('article-vectors-repository', () => {
  beforeEach(() => {
    db.exec('DELETE FROM article_vectors');
  });

  it('stores and overwrites an embedding for an article', () => {
    upsertArticleVector('a', [0.1, 0.2, 0.3]);
    upsertArticleVector('a', [0.9, 0.9, 0.9]);
    const nearest = findNearestArticles([0.9, 0.9, 0.9], 1);
    expect(nearest[0].articleId).toBe('a');
    expect(nearest[0].distance).toBeCloseTo(0, 5);
  });

  it('returns nearest neighbours ordered by distance', () => {
    upsertArticleVector('a', [0, 0, 0]);
    upsertArticleVector('b', [1, 0, 0]);
    upsertArticleVector('c', [0, 1, 0]);
    const nearest = findNearestArticles([0.05, 0, 0], 2);
    expect(nearest.map((n) => n.articleId)).toEqual(['a', 'b']);
  });
});
