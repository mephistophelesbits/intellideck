import 'server-only';

import { getDb } from './db';

export interface NearestArticle {
  articleId: string;
  distance: number;
}

export function upsertArticleVector(articleId: string, embedding: number[]): void {
  const db = getDb();
  // vec0 has no UPSERT; delete-then-insert keeps it idempotent.
  db.prepare('DELETE FROM article_vectors WHERE article_id = ?').run(articleId);
  db.prepare('INSERT INTO article_vectors (article_id, embedding) VALUES (?, ?)').run(
    articleId,
    JSON.stringify(embedding),
  );
}

export function findNearestArticles(embedding: number[], limit: number): NearestArticle[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT article_id AS articleId, distance
       FROM article_vectors
       WHERE embedding MATCH ?
       ORDER BY distance
       LIMIT ?`,
    )
    .all(JSON.stringify(embedding), limit) as Array<{ articleId: string; distance: number }>;
  return rows.map((row) => ({ articleId: row.articleId, distance: row.distance }));
}
