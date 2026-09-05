# Near-Duplicate Detection (#2) — Design

**Date:** 2026-06-23
**Goal:** Stop near-verbatim reposts/syndicated copies from inflating story
`article_count`, actor weights, trajectory events, and the distinct-source count, by
skipping enrichment for an incoming article that is a near-duplicate of a recent one.

## Motivation

Story clustering, actor weights (`article_entities`), trajectory (event cadence), and the
distinct-source signal (#7/#4) all assume each article is an independent contribution.
Near-verbatim reposts violate that — a syndicated wire story republished by N outlets
looks bigger and more "escalating" than it is, and counts as N independent sources when
it is really one. A measured vector-distance check can catch these.

## Calibration (already measured)

The diagnostic route `GET /api/admin/dedup-distances` (commit `05ff740`) sampled
nearest-neighbour L2 distances in `article_vectors` (vec0, L2 on FLOAT[768]):
min ≈ 0 (exact dups present), p1 ≈ 3.97, p5 ≈ 7.25, p50 ≈ 11.9. Every sampled pair below
~4.0 was a true duplicate/rewording; the 4–7 band is mixed (real reposts AND distinct
same-topic items, e.g. 现货白银 大跌4% vs 涨幅2% at 6.33). **Safe cutoff ≈ 3.5–4.0;
default 3.75.**

## Components

### New `lib/server/dedup.ts`
```
export const DEDUP_DISTANCE_THRESHOLD = 3.75;   // L2
export const DEDUP_WINDOW_DAYS = 7;
export function findNearDuplicate(
  selfId: string,
  embedding: number[],
  now?: number,
): { articleId: string; distance: number } | null
```
- Calls `findNearestArticles(embedding, 2)` (from `article-vectors-repository`) and takes
  the first hit whose `articleId !== selfId`. Self-exclusion matters because
  re-enrichment runs on an article whose vector is already indexed (else it self-matches
  at distance 0).
- Returns the neighbour only if `distance < DEDUP_DISTANCE_THRESHOLD` AND the neighbour's
  `articles.created_at` is within `DEDUP_WINDOW_DAYS` of `now` (recency guard: a genuinely
  new article must not be dropped for matching an old evergreen/recurring post). A
  missing/unparseable `created_at` → treated as not-recent → `null`.
- Wrapped in try/catch → `null` on any error (fail-open: never drop an article because
  the dedup check failed).

### Modified `enrichArticleWithAI` (articles-repository.ts)
After embedding + `upsertArticleVector`, before entity extraction and story assignment:
```
if (embedding?.length) {
  const dup = findNearDuplicate(article.articleId, embedding);
  if (dup) {
    console.log(`[enrich] near-duplicate of ${dup.articleId} (d=${dup.distance.toFixed(2)}); skipping enrichment for ${article.articleId}`);
    return;
  }
}
```
The article still ingests and keeps its vector; it contributes nothing to entities,
stories, actor weights, trajectory, or distinct-source counts.

## Data flow

```
ingest → embed → upsertArticleVector(self)
  → findNearDuplicate(self, embedding):
       nearest non-self < 3.75 AND neighbour created_at within 7d ? -> DUP
  → DUP:   return (skip entities + story assignment)
  → else:  deterministic entities + vector-only story assignment (as today)
```

## Error handling
- `findNearDuplicate` returns `null` on any thrown error (fail-open).
- Empty embedding → the existing `if (embedding?.length)` guard skips the dedup check (and
  story assignment), unchanged.

## Testing
- `dedup.test.ts` (mock `findNearestArticles` and `getDb` for the `created_at` lookup —
  vec0 is not loadable under vitest):
  - nearest non-self within threshold AND recent → returns it;
  - within threshold but older than the window → `null`;
  - above threshold → `null`;
  - only self in the index → `null`;
  - neighbour with missing/unparseable `created_at` → `null`;
  - `findNearestArticles` throws → `null`.
- Extend `articles-repository.enrich.test.ts` (mock `./dedup`):
  - `findNearDuplicate` returns a dup → `upsertEntitiesForArticle` and
    `assignArticleToStory` are NOT called; `embedText`/`upsertArticleVector` still ran;
  - returns `null` → both ARE called (normal path unchanged).

## Out of scope
- A `duplicate_of` column / UI "duplicate of X" marker (action is skip-enrichment; no
  schema change).
- Cross-source-specific handling (skip applies regardless of source — near-verbatim is
  not independent corroboration).
- Re-tuning the threshold beyond the measured default (the diagnostic route remains for
  re-calibration).
- Removing the diagnostic route (separate cleanup once this lands).
