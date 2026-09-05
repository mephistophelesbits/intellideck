import 'server-only';

import { getDb } from './db';
import { findNearestArticles } from './article-vectors-repository';

/** L2 distance below which two article embeddings are treated as near-duplicates. */
export const DEDUP_DISTANCE_THRESHOLD = 3.75;
/** Only the last N days of articles are dedup candidates (avoids matching evergreen/recurring posts). */
export const DEDUP_WINDOW_DAYS = 7;

/**
 * Returns the nearest existing article that is a near-duplicate of `embedding` — i.e. a
 * different recent article within DEDUP_DISTANCE_THRESHOLD — or null. Self-excluding (the
 * caller's vector may already be indexed on re-enrichment). Fail-open: any error → null,
 * so a failed check never drops a real article.
 */
export function findNearDuplicate(
  selfId: string,
  embedding: number[],
  now: number = Date.now(),
): { articleId: string; distance: number } | null {
  try {
    if (!embedding || embedding.length === 0) return null;
    const hits = findNearestArticles(embedding, 2);
    const neighbor = hits.find((h) => h.articleId !== selfId);
    if (!neighbor || neighbor.distance >= DEDUP_DISTANCE_THRESHOLD) return null;

    const row = getDb()
      .prepare('SELECT created_at FROM articles WHERE id = ?')
      .get(neighbor.articleId) as { created_at: string } | undefined;
    if (!row) return null;
    const ts = Date.parse(row.created_at);
    if (Number.isNaN(ts)) return null;
    if ((now - ts) / 86_400_000 > DEDUP_WINDOW_DAYS) return null;

    return { articleId: neighbor.articleId, distance: neighbor.distance };
  } catch {
    return null;
  }
}
