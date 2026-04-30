import 'server-only';
import { getDb } from './db';

export function markRead(articleId: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO read_articles (article_id, read_at)
    VALUES (?, ?)
  `).run(articleId, now);
}

export function markAllRead(articleIds: string[]): void {
  if (articleIds.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO read_articles (article_id, read_at)
    VALUES (?, ?)
  `);
  for (const id of articleIds) {
    stmt.run(id, now);
  }
}

export function getAllReadIds(): string[] {
  const db = getDb();
  return (db.prepare('SELECT article_id FROM read_articles').all() as { article_id: string }[])
    .map((row) => row.article_id);
}
