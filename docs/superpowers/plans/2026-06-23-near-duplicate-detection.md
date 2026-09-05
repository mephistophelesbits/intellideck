# Near-Duplicate Detection (#2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skip enrichment for an incoming article that is a near-duplicate (vector L2 < 3.75, within a 7-day window) of a recent one, so reposts don't inflate stories/actors/trajectory/source counts.

**Architecture:** A new `dedup.ts` does a self-excluding nearest-neighbour lookup with a recency guard and fail-open error handling. `enrichArticleWithAI` early-returns (skipping entity extraction + story assignment) when a near-duplicate is found.

**Tech Stack:** TypeScript, `node:sqlite`, sqlite-vec, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-23-near-duplicate-detection-design.md`

---

## File Structure
- **Create** `lib/server/dedup.ts` — `findNearDuplicate(selfId, embedding, now?)`.
- **Create** `lib/server/dedup.test.ts` — unit tests (mock vectors repo + db).
- **Modify** `lib/server/articles-repository.ts` — early-return on near-dup in `enrichArticleWithAI`.
- **Modify** `lib/server/articles-repository.enrich.test.ts` — guard tests for dup/non-dup.

---

## Task 1: dedup module

**Files:**
- Create: `lib/server/dedup.ts`
- Test: `lib/server/dedup.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/server/dedup.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const nearestMock = vi.fn();
vi.mock('./article-vectors-repository', () => ({
  findNearestArticles: (...args: unknown[]) => nearestMock(...args),
}));

const createdAtById = new Map<string, string>();
vi.mock('./db', () => ({
  getDb: () => ({
    prepare: () => ({
      get: (id: string) => {
        const v = createdAtById.get(id);
        return v ? { created_at: v } : undefined;
      },
    }),
  }),
}));

import { findNearDuplicate, DEDUP_DISTANCE_THRESHOLD } from './dedup';

const NOW = Date.parse('2026-06-23T12:00:00Z');
const recent = '2026-06-23T06:00:00Z'; // 6h ago
const old = '2026-06-10T12:00:00Z'; // 13 days ago

beforeEach(() => { nearestMock.mockReset(); createdAtById.clear(); });

describe('findNearDuplicate', () => {
  it('returns the neighbour when within threshold and recent (excluding self)', () => {
    nearestMock.mockReturnValue([{ articleId: 'self', distance: 0 }, { articleId: 'twin', distance: 2.0 }]);
    createdAtById.set('twin', recent);
    expect(findNearDuplicate('self', [1, 0, 0], NOW)).toEqual({ articleId: 'twin', distance: 2.0 });
  });

  it('returns null when the neighbour is older than the window', () => {
    nearestMock.mockReturnValue([{ articleId: 'self', distance: 0 }, { articleId: 'twin', distance: 2.0 }]);
    createdAtById.set('twin', old);
    expect(findNearDuplicate('self', [1, 0, 0], NOW)).toBeNull();
  });

  it('returns null when the nearest non-self is above threshold', () => {
    nearestMock.mockReturnValue([{ articleId: 'self', distance: 0 }, { articleId: 'twin', distance: 5.0 }]);
    createdAtById.set('twin', recent);
    expect(findNearDuplicate('self', [1, 0, 0], NOW)).toBeNull();
  });

  it('returns null when only self is in the index', () => {
    nearestMock.mockReturnValue([{ articleId: 'self', distance: 0 }]);
    expect(findNearDuplicate('self', [1, 0, 0], NOW)).toBeNull();
  });

  it('returns null when the neighbour has no created_at', () => {
    nearestMock.mockReturnValue([{ articleId: 'twin', distance: 2.0 }]);
    // createdAtById has no 'twin'
    expect(findNearDuplicate('self', [1, 0, 0], NOW)).toBeNull();
  });

  it('returns null (fail-open) when the lookup throws', () => {
    nearestMock.mockImplementation(() => { throw new Error('vec exploded'); });
    expect(findNearDuplicate('self', [1, 0, 0], NOW)).toBeNull();
  });

  it('exposes the measured threshold default', () => {
    expect(DEDUP_DISTANCE_THRESHOLD).toBe(3.75);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run dedup`
Expected: FAIL — module/function not found.

- [ ] **Step 3: Implement**

```typescript
// lib/server/dedup.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run dedup`
Expected: PASS (7 tests). Then `npx tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/server/dedup.ts lib/server/dedup.test.ts
git commit -m "feat: near-duplicate detection helper (vector distance + recency, fail-open)"
```

---

## Task 2: Skip enrichment for near-duplicates

**Files:**
- Modify: `lib/server/articles-repository.ts` (`enrichArticleWithAI`, between the embedding block and the entity block ~line 762-764)
- Test: `lib/server/articles-repository.enrich.test.ts`

- [ ] **Step 1: Add guard tests**

In `lib/server/articles-repository.enrich.test.ts`, add a mock for `./dedup` (alongside the existing mocks, before `import { enrichArticleWithAI }`):

```typescript
const findNearDuplicate = vi.fn(() => null as null | { articleId: string; distance: number });
vi.mock('./dedup', () => ({ findNearDuplicate: (...a: unknown[]) => findNearDuplicate(...a) }));
```

Import the mocked collaborators to assert on them (add to the existing imports):

```typescript
import { upsertEntitiesForArticle } from './entities-repository';
import { assignArticleToStory } from './story-assignment';
```

Add to the existing `beforeEach` reset: `findNearDuplicate.mockReturnValue(null);`

Then add these tests inside the existing `describe('enrichArticleWithAI (LLM-free hot path)', ...)`:

```typescript
  it('skips entity extraction and story assignment for a near-duplicate', async () => {
    findNearDuplicate.mockReturnValue({ articleId: 'twin', distance: 2.0 });
    await enrichArticleWithAI({
      articleId: 'a1', title: 'Repost', contentSnippet: 's', rawContent: 'b',
      occurredAt: new Date().toISOString(),
    });
    expect(embedText).toHaveBeenCalledTimes(1); // still embeds
    expect(upsertEntitiesForArticle).not.toHaveBeenCalled();
    expect(assignArticleToStory).not.toHaveBeenCalled();
  });

  it('runs the normal path when not a near-duplicate', async () => {
    findNearDuplicate.mockReturnValue(null);
    await enrichArticleWithAI({
      articleId: 'a1', title: 'Fresh', contentSnippet: 's', rawContent: 'b',
      occurredAt: new Date().toISOString(),
    });
    expect(upsertEntitiesForArticle).toHaveBeenCalledTimes(1);
    expect(assignArticleToStory).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run articles-repository.enrich`
Expected: FAIL — the near-duplicate test fails because enrichment is not yet skipped (`upsertEntitiesForArticle`/`assignArticleToStory` are still called).

- [ ] **Step 3: Add the import**

In `lib/server/articles-repository.ts`, with the other `./` imports, add:

```typescript
import { findNearDuplicate } from './dedup';
```

- [ ] **Step 4: Insert the early-return in `enrichArticleWithAI`**

Immediately AFTER the embedding try/catch block (the one ending with the `console.error(\`[enrich] embedding failed ...\`)` catch) and BEFORE the `// Deterministic entities` block, insert:

```typescript
  // Near-duplicate guard: a near-verbatim repost of a recent article should not inflate
  // any story/actor/trajectory/source counts. It still ingests (and keeps its vector).
  if (embedding && embedding.length > 0) {
    const dup = findNearDuplicate(article.articleId, embedding);
    if (dup) {
      console.log(`[enrich] near-duplicate of ${dup.articleId} (d=${dup.distance.toFixed(2)}); skipping enrichment for ${article.articleId}`);
      return;
    }
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run articles-repository.enrich`
Expected: PASS (existing + 2 new). Then `npx tsc --noEmit` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/server/articles-repository.ts lib/server/articles-repository.enrich.test.ts
git commit -m "feat: skip enrichment for near-duplicate articles (anti-inflation)"
```

---

## Task 3: Full verification

- [ ] **Step 1: Whole suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass; tsc exit 0.

---

## Self-review notes
- Spec coverage: `findNearDuplicate` with self-exclusion, threshold, recency guard, fail-open (Task 1, all six dedup cases + threshold constant); hot-path early-return skipping entities + story assignment (Task 2, dup + non-dup). Covered.
- Type consistency: `findNearDuplicate(selfId, embedding, now?) : { articleId, distance } | null` used identically in module, dedup tests, and the enrich mock.
- The guard sits inside `if (embedding && embedding.length > 0)`, mirroring the existing story-assignment guard, so an embed failure (no embedding) cleanly skips dedup too.
- `findNearestArticles` already exists and is unchanged; `created_at` is an existing `articles` column.
