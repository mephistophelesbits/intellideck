import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/server/db';

/**
 * READ-ONLY diagnostic for near-duplicate detection (#2). For a sample of recent
 * articles, finds each one's nearest OTHER article in the vector store and reports the
 * distribution of those nearest-neighbour distances, plus the closest pairs (titles) so
 * we can eyeball where true reposts/duplicates sit. Use this to pick a safe dedup
 * threshold before building #2. vec0 uses L2 distance on FLOAT[768].
 *
 * GET /api/admin/dedup-distances?sample=300
 */
export async function GET(request: NextRequest) {
  const sample = Math.min(2000, Math.max(10, Number(new URL(request.url).searchParams.get('sample') ?? 300)));
  const db = getDb();

  const ids = db
    .prepare(
      `SELECT a.id AS id, a.title AS title
       FROM articles a JOIN article_vectors av ON av.article_id = a.id
       ORDER BY a.created_at DESC
       LIMIT ?`,
    )
    .all(sample) as Array<{ id: string; title: string }>;

  const getVec = db.prepare('SELECT vec_to_json(embedding) AS v FROM article_vectors WHERE article_id = ?');
  const nearest = db.prepare(
    'SELECT article_id AS id, distance FROM article_vectors WHERE embedding MATCH ? ORDER BY distance LIMIT 2',
  );
  const titleOf = db.prepare('SELECT title FROM articles WHERE id = ?');

  const distances: number[] = [];
  const pairs: Array<{ d: number; a: string; b: string }> = [];

  for (const row of ids) {
    const vrow = getVec.get(row.id) as { v: string } | undefined;
    if (!vrow?.v) continue;
    let res: Array<{ id: string; distance: number }>;
    try {
      res = nearest.all(vrow.v) as Array<{ id: string; distance: number }>;
    } catch {
      continue;
    }
    const other = res.find((r) => r.id !== row.id);
    if (!other) continue;
    distances.push(other.distance);
    const otherTitle = (titleOf.get(other.id) as { title: string } | undefined)?.title ?? '?';
    pairs.push({ d: other.distance, a: row.title, b: otherTitle });
  }

  distances.sort((x, y) => x - y);
  const pct = (p: number): number | null =>
    distances.length ? distances[Math.min(distances.length - 1, Math.floor((p / 100) * distances.length))] : null;

  // 0.1-wide histogram buckets of nearest-neighbour distance.
  const histogram: Record<string, number> = {};
  for (const d of distances) {
    const bucket = (Math.floor(d * 10) / 10).toFixed(1);
    histogram[bucket] = (histogram[bucket] ?? 0) + 1;
  }

  pairs.sort((a, b) => a.d - b.d);

  return NextResponse.json({
    metric: 'L2 (vec0 default on FLOAT[768])',
    sampled: distances.length,
    nearestNeighborDistance: {
      min: distances[0] ?? null,
      p1: pct(1),
      p5: pct(5),
      p10: pct(10),
      p25: pct(25),
      p50: pct(50),
      p90: pct(90),
      max: distances[distances.length - 1] ?? null,
    },
    histogram,
    closestPairs: pairs.slice(0, 30),
  });
}
