import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

// Mock server-only so it doesn't throw in test env
vi.mock('server-only', () => ({}));

// Create in-memory database once
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE IF NOT EXISTS read_articles (
    article_id TEXT PRIMARY KEY,
    read_at    TEXT NOT NULL
  );
`);

// Mock the db module
vi.mock('./db', () => ({
  getDb: () => db,
}));

import { markRead, markAllRead, getAllReadIds } from './read-articles-repository';

describe('read-articles-repository', () => {
  beforeEach(() => {
    db.exec('DELETE FROM read_articles');
  });

  describe('markRead', () => {
    it('stores an article id', () => {
      markRead('article-1');
      expect(getAllReadIds()).toContain('article-1');
    });

    it('is idempotent — calling twice does not throw', () => {
      markRead('article-1');
      expect(() => markRead('article-1')).not.toThrow();
    });
  });

  describe('markAllRead', () => {
    it('stores multiple article ids at once', () => {
      markAllRead(['article-2', 'article-3', 'article-4']);
      const ids = getAllReadIds();
      expect(ids).toContain('article-2');
      expect(ids).toContain('article-3');
      expect(ids).toContain('article-4');
    });

    it('does nothing for an empty array', () => {
      expect(() => markAllRead([])).not.toThrow();
      expect(getAllReadIds()).toHaveLength(0);
    });
  });

  describe('getAllReadIds', () => {
    it('returns empty array when nothing is read', () => {
      expect(getAllReadIds()).toEqual([]);
    });

    it('returns all stored ids', () => {
      markRead('a');
      markRead('b');
      const ids = getAllReadIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain('a');
      expect(ids).toContain('b');
    });
  });
});
