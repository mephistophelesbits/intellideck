import 'server-only';

import { Article } from '@/lib/types';
import { getDb } from './db';

export function getBookmarks() {
  const db = getDb();
  return db.prepare(`
    SELECT article_json
    FROM bookmarks
    ORDER BY updated_at DESC, created_at DESC
  `).all().map((row) => {
    const data = row as { article_json: string };
    return JSON.parse(data.article_json) as Article;
  });
}

export function saveBookmark(article: Article) {
  const db = getDb();
  const now = new Date().toISOString();
  const payload = JSON.stringify({ ...article, bookmarked: true });

  db.prepare(`
    INSERT INTO bookmarks (id, article_json, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      article_json = excluded.article_json,
      updated_at = excluded.updated_at
  `).run(article.id, payload, now, now);

  return getBookmarks();
}

export function deleteBookmark(articleId: string) {
  const db = getDb();
  db.prepare(`DELETE FROM bookmarks WHERE id = ?`).run(articleId);
  return getBookmarks();
}
