# Clustering Shared-Entity Corroboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a shared named entity to corroborate a story merge in the uncertain similarity band (0.83–0.88), reducing false merges while leaving confident merges (≥0.88) unchanged.

**Architecture:** A new `story-corroboration.ts` answers "does this article share an entity with this story?" (with a no-entity → true fallback). `assignArticleToStory` becomes two-tier: auto-merge ≥0.88, require corroboration in 0.83–0.88, new story below.

**Tech Stack:** TypeScript, `node:sqlite`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-23-clustering-corroboration-design.md`

---

## File Structure
- **Create** `lib/server/story-corroboration.ts` — `articleSharesEntityWithStory(articleId, storyId): boolean`.
- **Create** `lib/server/story-corroboration.test.ts` — unit tests.
- **Modify** `lib/server/story-assignment.ts` — add `STORY_AUTO_MERGE_THRESHOLD`, two-tier decision.
- **Modify** `lib/server/story-assignment.test.ts` — add `article_entities` table + band-case tests.

---

## Task 1: Corroboration module

**Files:**
- Create: `lib/server/story-corroboration.ts`
- Test: `lib/server/story-corroboration.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/server/story-corroboration.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE article_entities (article_id TEXT NOT NULL, entity_id TEXT NOT NULL, PRIMARY KEY (article_id, entity_id));
  CREATE TABLE story_articles (story_id TEXT, article_id TEXT, added_at TEXT NOT NULL, PRIMARY KEY (story_id, article_id));
`);
vi.mock('./db', () => ({ getDb: () => db }));

import { articleSharesEntityWithStory } from './story-corroboration';

beforeEach(() => { db.exec('DELETE FROM article_entities; DELETE FROM story_articles;'); });

describe('articleSharesEntityWithStory', () => {
  it('returns true when the article and story share an entity', () => {
    db.exec(`
      INSERT INTO story_articles (story_id, article_id, added_at) VALUES ('s1','a0','t');
      INSERT INTO article_entities (article_id, entity_id) VALUES ('a0','e1'), ('a1','e1'), ('a1','e9');
    `);
    expect(articleSharesEntityWithStory('a1', 's1')).toBe(true);
  });

  it('returns false when their entities are disjoint', () => {
    db.exec(`
      INSERT INTO story_articles (story_id, article_id, added_at) VALUES ('s1','a0','t');
      INSERT INTO article_entities (article_id, entity_id) VALUES ('a0','e1'), ('a1','e2');
    `);
    expect(articleSharesEntityWithStory('a1', 's1')).toBe(false);
  });

  it('returns true (fallback) when the article has no entities', () => {
    db.exec(`
      INSERT INTO story_articles (story_id, article_id, added_at) VALUES ('s1','a0','t');
      INSERT INTO article_entities (article_id, entity_id) VALUES ('a0','e1');
    `);
    expect(articleSharesEntityWithStory('a1', 's1')).toBe(true);
  });

  it('returns false when the article has entities but the story has none', () => {
    db.exec(`INSERT INTO article_entities (article_id, entity_id) VALUES ('a1','e1');`);
    expect(articleSharesEntityWithStory('a1', 'empty-story')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run story-corroboration`
Expected: FAIL — `articleSharesEntityWithStory` not exported.

- [ ] **Step 3: Implement**

```typescript
// lib/server/story-corroboration.ts
import 'server-only';

import { getDb } from './db';

/**
 * Does the incoming article share at least one named entity with the candidate story?
 * Used as a deterministic merge guard in the uncertain similarity band.
 *
 * No-entity fallback: if the ARTICLE has no entities we cannot corroborate, so we
 * return true (the caller falls back to cosine-only — don't penalize entity-less
 * articles). Any DB error returns false (treated as "not corroborated" → new story,
 * biased against a false merge).
 */
export function articleSharesEntityWithStory(articleId: string, storyId: string): boolean {
  try {
    const db = getDb();
    const articleRows = db
      .prepare('SELECT entity_id FROM article_entities WHERE article_id = ?')
      .all(articleId) as Array<{ entity_id: string }>;
    if (articleRows.length === 0) return true; // fallback: cannot corroborate, don't penalize
    const articleIds = new Set(articleRows.map((r) => r.entity_id));

    const storyRows = db
      .prepare(
        `SELECT DISTINCT ae.entity_id AS entity_id
         FROM story_articles sa
         JOIN article_entities ae ON ae.article_id = sa.article_id
         WHERE sa.story_id = ?`,
      )
      .all(storyId) as Array<{ entity_id: string }>;

    for (const r of storyRows) {
      if (articleIds.has(r.entity_id)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run story-corroboration`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/story-corroboration.ts lib/server/story-corroboration.test.ts
git commit -m "feat: shared-entity corroboration helper for clustering"
```

---

## Task 2: Two-tier merge in assignArticleToStory

**Files:**
- Modify: `lib/server/story-assignment.ts` (constant near line 14; decision block near lines 104-124)
- Test: `lib/server/story-assignment.test.ts`

- [ ] **Step 1: Add band-case tests**

In `lib/server/story-assignment.test.ts`, add `article_entities` to the in-memory schema (in the `db.exec(...)` CREATE block, alongside the existing tables):

```typescript
  CREATE TABLE article_entities (article_id TEXT NOT NULL, entity_id TEXT NOT NULL, PRIMARY KEY (article_id, entity_id));
```

Add this import line next to the existing imports:

```typescript
import { STORY_AUTO_MERGE_THRESHOLD } from './story-assignment';
```

Add to the `beforeEach` DELETE sweep: `DELETE FROM article_entities;` (append to the existing exec string).

Then add these tests inside the `describe('assignArticleToStory (vector-only)', ...)` block. Note: `[0.85, 0.5268, 0]` has cosine ≈ 0.85 with `[1,0,0]`, landing in the 0.83–0.88 band (recency weight ≈ 1 since the seeded `last_updated` is unparseable):

```typescript
  it('auto-merges a confident match (>=0.88) without needing a shared entity', async () => {
    const existing = createStory({ title: 'Quake', articleId: 'a0', occurredAt: 't', embedding: [1, 0, 0], eventSummary: 'e' });
    const r = await assignArticleToStory({ articleId: 'a1', title: 'Quake update', snippet: 's', occurredAt: 't2', embedding: [0.99, 0.01, 0] });
    expect(r.created).toBe(false);
    expect(r.storyId).toBe(existing);
  });

  it('merges in the uncertain band when a shared entity corroborates', async () => {
    const existing = createStory({ title: 'Quake', articleId: 'a0', occurredAt: 't', embedding: [1, 0, 0], eventSummary: 'e' });
    db.exec(`INSERT INTO article_entities (article_id, entity_id) VALUES ('a0','e1'), ('a1','e1');`);
    const r = await assignArticleToStory({ articleId: 'a1', title: 'Related', snippet: 's', occurredAt: 't2', embedding: [0.85, 0.5268, 0] });
    expect(r.created).toBe(false);
    expect(r.storyId).toBe(existing);
  });

  it('creates a new story in the uncertain band when no entity corroborates', async () => {
    createStory({ title: 'Quake', articleId: 'a0', occurredAt: 't', embedding: [1, 0, 0], eventSummary: 'e' });
    db.exec(`INSERT INTO article_entities (article_id, entity_id) VALUES ('a0','e1'), ('a1','e2');`);
    const r = await assignArticleToStory({ articleId: 'a1', title: 'Unrelated-ish', snippet: 's', occurredAt: 't2', embedding: [0.85, 0.5268, 0] });
    expect(r.created).toBe(true);
  });

  it('merges in the band when the article has no entities (fallback)', async () => {
    const existing = createStory({ title: 'Quake', articleId: 'a0', occurredAt: 't', embedding: [1, 0, 0], eventSummary: 'e' });
    db.exec(`INSERT INTO article_entities (article_id, entity_id) VALUES ('a0','e1');`);
    const r = await assignArticleToStory({ articleId: 'a1', title: 'No entities', snippet: 's', occurredAt: 't2', embedding: [0.85, 0.5268, 0] });
    expect(r.created).toBe(false);
    expect(r.storyId).toBe(existing);
  });

  it('exposes the auto-merge ceiling constant', () => {
    expect(STORY_AUTO_MERGE_THRESHOLD).toBe(0.88);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run story-assignment`
Expected: FAIL — `STORY_AUTO_MERGE_THRESHOLD` not exported; band tests merge/new-story incorrectly (current code merges anything ≥0.83 regardless of entities).

- [ ] **Step 3: Add the constant**

In `lib/server/story-assignment.ts`, immediately after the `STORY_SIM_THRESHOLD` line:

```typescript
/**
 * Above this (recency-weighted) similarity a merge is confident enough to skip the
 * shared-entity check. Between STORY_SIM_THRESHOLD and this, a merge needs a shared
 * named entity to corroborate (deterministic stand-in for the old LLM adjudicator).
 */
export const STORY_AUTO_MERGE_THRESHOLD = 0.88;
```

- [ ] **Step 4: Wire corroboration into the decision block**

Add the import near the top of `lib/server/story-assignment.ts` (with the other `./` imports):

```typescript
import { articleSharesEntityWithStory } from './story-corroboration';
```

Replace the existing `if (best && best.score >= STORY_SIM_THRESHOLD) { ... }` block with:

```typescript
  if (best && best.score >= STORY_SIM_THRESHOLD) {
    // Two-tier: a confident match auto-merges; in the uncertain band require a shared
    // entity to corroborate. The optional LLM adjudicator still applies when supplied
    // (the default ingestion path passes none — clustering is LLM-free).
    const corroborated =
      best.score >= STORY_AUTO_MERGE_THRESHOLD ||
      articleSharesEntityWithStory(input.articleId, best.id);
    if (corroborated) {
      let sameStory = true;
      if (deps) {
        const story = getStoryById(best.id);
        sameStory = story
          ? await deps.adjudicate(input, { title: story.title, summary: story.summary })
          : false;
      }
      if (sameStory) {
        attachArticleToStory({
          storyId: best.id,
          articleId: input.articleId,
          occurredAt: input.occurredAt,
          embedding: input.embedding,
          eventSummary,
        });
        return { storyId: best.id, created: false };
      }
    }
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run story-assignment`
Expected: PASS (existing tests + 5 new). Then `npx tsc --noEmit` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/server/story-assignment.ts lib/server/story-assignment.test.ts
git commit -m "feat: two-tier story merge (auto >=0.88, shared-entity corroboration 0.83-0.88)"
```

---

## Task 3: Full verification

- [ ] **Step 1: Whole suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass; tsc exit 0.

---

## Self-review notes
- Spec coverage: corroboration module (Task 1) + no-entity fallback + DB-error→false (Task 1 impl/tests); two-tier decision + 0.88 constant (Task 2); band cases a/b/c/d + constant test (Task 2 Step 1). All spec points covered.
- The corroboration query joins only `story_articles` ⋈ `article_entities` (no `entities` table needed), so the test fixture stays minimal.
- `getStoryById` import in story-assignment.ts is retained (still used in the `deps` branch).
