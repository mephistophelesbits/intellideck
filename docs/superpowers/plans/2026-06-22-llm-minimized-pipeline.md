# LLM-Minimized Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all per-article LLM calls from the ingestion pipeline, deriving situation-mapping fields deterministically, and reserve the LLM for top board-story summaries (gated), the world-synthesis narrative, and the daily briefing.

**Architecture:** Per-article enrichment keeps embeddings + regex tagging + vector clustering only (no gemma calls). A new deterministic `story-metadata` module computes actors (entity frequency) and trajectory (event cadence) for every story. LLM story summaries are gated to the top ~5 board stories on the worker tick (warm) and generated lazily on first view for ranks 6–12.

**Tech Stack:** TypeScript, Next.js App Router, `node:sqlite` (`DatabaseSync`), sqlite-vec, Ollama (embeddings only in the hot path), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-22-llm-minimized-pipeline-design.md`

---

## File Structure

- **Create** `lib/server/story-metadata.ts` — deterministic actors (entity aggregation) + trajectory (event cadence). One responsibility: compute mapping fields from stored data, no LLM, no network.
- **Create** `lib/server/story-metadata.test.ts` — unit tests for the above.
- **Modify** `lib/server/story-assignment.ts` — make the adjudicator optional; vector-only assignment; raise threshold.
- **Modify** `lib/server/story-assignment.test.ts` — rewrite for the vector-only path (also fixes the pre-existing missing-column fixture).
- **Modify** `lib/server/articles-repository.ts` — strip the two per-article LLM calls from `enrichArticleWithAI`; apply deterministic metadata on assignment.
- **Create** `lib/server/articles-repository.enrich.test.ts` — guard test: `generateText` is never called in the per-article path.
- **Modify** `lib/server/stories-repository.ts` — gate `regenerateDirtyStorySummaries` to the top-N board ranking; add `ensureStorySummary(storyId)` for the lazy path.
- **Modify** `lib/server/background-worker.ts` — refresh deterministic metadata for active stories each idle pass; keep LLM summaries gated to top-N.
- **Modify** `app/api/stories/[id]/route.ts` — trigger lazy summary on story-detail fetch.

---

## Task 1: Deterministic story-metadata module

**Files:**
- Create: `lib/server/story-metadata.ts`
- Test: `lib/server/story-metadata.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/server/story-metadata.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE entities (id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL, entity_type TEXT NOT NULL);
  CREATE TABLE article_entities (article_id TEXT NOT NULL, entity_id TEXT NOT NULL, mention_count INTEGER NOT NULL, weight REAL NOT NULL DEFAULT 1, PRIMARY KEY(article_id, entity_id));
  CREATE TABLE story_articles (story_id TEXT, article_id TEXT, added_at TEXT NOT NULL, PRIMARY KEY (story_id, article_id));
  CREATE TABLE story_events (id TEXT PRIMARY KEY, story_id TEXT NOT NULL, occurred_at TEXT NOT NULL, summary TEXT NOT NULL);
`);
vi.mock('./db', () => ({ getDb: () => db }));

import { buildDeterministicActors, computeTrajectory } from './story-metadata';

beforeEach(() => {
  db.exec('DELETE FROM entities; DELETE FROM article_entities; DELETE FROM story_articles; DELETE FROM story_events;');
});

describe('buildDeterministicActors', () => {
  it('ranks actors by total mentions across the story and caps at 5', () => {
    db.exec(`
      INSERT INTO entities (id, name, normalized_name, entity_type) VALUES
        ('e1','Federal Reserve','federal reserve','organization'),
        ('e2','Jerome Powell','jerome powell','person'),
        ('e3','Wall Street','wall street','organization');
      INSERT INTO story_articles (story_id, article_id, added_at) VALUES ('s1','a1','2026-06-22T00:00:00Z'), ('s1','a2','2026-06-22T01:00:00Z');
      INSERT INTO article_entities (article_id, entity_id, mention_count, weight) VALUES
        ('a1','e1',3,1), ('a2','e1',2,1), ('a1','e2',4,1), ('a1','e3',1,1);
    `);
    const actors = buildDeterministicActors('s1');
    expect(actors.map((a) => a.name)).toEqual(['Federal Reserve', 'Jerome Powell', 'Wall Street']);
    expect(actors[0]).toEqual({ name: 'Federal Reserve', role: 'organization', stance: '' });
    expect(actors.length).toBeLessThanOrEqual(5);
  });

  it('returns [] for a story with no entities', () => {
    expect(buildDeterministicActors('nope')).toEqual([]);
  });
});

describe('computeTrajectory', () => {
  it('returns dormant when no events in the last 24h', () => {
    expect(computeTrajectory('empty')).toMatch(/dormant/i);
  });

  it('returns escalating when recent events far exceed the prior window', () => {
    db.exec(`
      INSERT INTO story_events (id, story_id, occurred_at, summary) VALUES
        ('ev1','s1',datetime('now','-1 hours'),'x'),
        ('ev2','s1',datetime('now','-2 hours'),'x'),
        ('ev3','s1',datetime('now','-3 hours'),'x'),
        ('ev4','s1',datetime('now','-30 hours'),'x');
    `);
    expect(computeTrajectory('s1')).toMatch(/escalating/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run story-metadata`
Expected: FAIL — `buildDeterministicActors`/`computeTrajectory` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/server/story-metadata.ts
import 'server-only';

import { getDb } from './db';
import type { StoryActor } from './stories-repository';

/**
 * Top key actors for a story, ranked by total entity mentions across its articles.
 * Deterministic — no LLM. role := entity_type, stance left blank (LLM fills stance
 * for top board stories; the long tail shows role only).
 */
export function buildDeterministicActors(storyId: string, limit = 5): StoryActor[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT e.name AS name, e.entity_type AS type, SUM(ae.mention_count) AS mentions
    FROM story_articles sa
    JOIN article_entities ae ON ae.article_id = sa.article_id
    JOIN entities e ON e.id = ae.entity_id
    WHERE sa.story_id = ?
    GROUP BY e.id
    ORDER BY mentions DESC, e.name ASC
    LIMIT ?
  `).all(storyId, limit) as Array<{ name: string; type: string; mentions: number }>;

  return rows.map((r) => ({ name: r.name, role: r.type, stance: '' }));
}

/**
 * Trajectory from event cadence: events in the last 24h vs the prior 24h.
 * Mirrors getSituationBoard's recent/baseline window pattern (datetime('now')).
 */
export function computeTrajectory(storyId: string): string {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN occurred_at > datetime('now','-24 hours') THEN 1 ELSE 0 END) AS recent,
      SUM(CASE WHEN occurred_at <= datetime('now','-24 hours')
               AND occurred_at > datetime('now','-48 hours') THEN 1 ELSE 0 END) AS prior
    FROM story_events WHERE story_id = ?
  `).get(storyId) as { recent: number | null; prior: number | null };

  const recent = row.recent ?? 0;
  const prior = row.prior ?? 0;

  if (recent === 0) return `Dormant — no new reports in 24h`;
  if (recent > prior * 1.5) return `Escalating — ${recent} reports in 24h vs ${prior} prior`;
  if (recent * 1.5 < prior) return `De-escalating — ${recent} reports in 24h vs ${prior} prior`;
  return `Developing — ${recent} reports in 24h vs ${prior} prior`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run story-metadata`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/story-metadata.ts lib/server/story-metadata.test.ts
git commit -m "feat: deterministic story actors + trajectory (no LLM)"
```

---

## Task 2: Vector-only story assignment (adjudicator optional)

**Files:**
- Modify: `lib/server/story-assignment.ts:14` (threshold), `:76-127` (assignArticleToStory)
- Test: `lib/server/story-assignment.test.ts` (rewrite)

- [ ] **Step 1: Rewrite the test for the vector-only path**

Replace the entire body of `lib/server/story-assignment.test.ts` with:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE stories (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'developing',
    summary TEXT, centroid TEXT, article_count INTEGER NOT NULL DEFAULT 0, salience REAL NOT NULL DEFAULT 0,
    summary_dirty_count INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_updated TEXT NOT NULL,
    summary_updated_at TEXT, actors_json TEXT, trajectory TEXT, stakes TEXT, one_liner TEXT,
    open_questions TEXT, contradictions TEXT, pinned INTEGER DEFAULT 0);
  CREATE TABLE story_articles (story_id TEXT, article_id TEXT, added_at TEXT NOT NULL, PRIMARY KEY (story_id, article_id));
  CREATE TABLE story_events (id TEXT PRIMARY KEY, story_id TEXT NOT NULL, occurred_at TEXT NOT NULL, summary TEXT NOT NULL, article_id TEXT);
`);
vi.mock('./db', () => ({ getDb: () => db }));

import { assignArticleToStory, STORY_SIM_THRESHOLD } from './story-assignment';
import { createStory } from './stories-repository';

beforeEach(() => { db.exec('DELETE FROM stories; DELETE FROM story_articles; DELETE FROM story_events;'); });

describe('assignArticleToStory (vector-only)', () => {
  it('creates a new story when there are no candidates', async () => {
    const r = await assignArticleToStory({ articleId: 'a1', title: 'Big quake', snippet: 's', occurredAt: 't', embedding: [1, 0, 0] });
    expect(r.created).toBe(true);
  });

  it('attaches to a similar story above threshold without any LLM', async () => {
    const existing = createStory({ title: 'Quake', articleId: 'a0', occurredAt: 't', embedding: [1, 0, 0], eventSummary: 'e' });
    const r = await assignArticleToStory({ articleId: 'a1', title: 'Quake aftermath', snippet: 's', occurredAt: 't2', embedding: [0.99, 0.01, 0] });
    expect(r.created).toBe(false);
    expect(r.storyId).toBe(existing);
  });

  it('creates a new story when below threshold', async () => {
    createStory({ title: 'Quake', articleId: 'a0', occurredAt: 't', embedding: [1, 0, 0], eventSummary: 'e' });
    const r = await assignArticleToStory({ articleId: 'a1', title: 'Unrelated', snippet: 's', occurredAt: 't2', embedding: [0, 1, 0] });
    expect(r.created).toBe(true);
  });

  it('skips when embedding is empty', async () => {
    const r = await assignArticleToStory({ articleId: 'a1', title: 'x', snippet: 's', occurredAt: 't', embedding: [] });
    expect(r.skipped).toBe(true);
  });

  it('exposes a raised, merge-safe threshold', () => {
    expect(STORY_SIM_THRESHOLD).toBeGreaterThanOrEqual(0.83);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run story-assignment`
Expected: FAIL — `assignArticleToStory` still requires a second arg / threshold is 0.78.

- [ ] **Step 3: Raise the threshold**

In `lib/server/story-assignment.ts`, change line 14:

```typescript
export const STORY_SIM_THRESHOLD = 0.83;
```

- [ ] **Step 4: Make the adjudicator optional and skip it in the vector path**

Replace the signature and the decision block in `assignArticleToStory`. Change:

```typescript
export async function assignArticleToStory(
  input: AssignArticleInput,
  deps: Adjudicator,
): Promise<AssignmentResult> {
```

to:

```typescript
export async function assignArticleToStory(
  input: AssignArticleInput,
  deps?: Adjudicator,
): Promise<AssignmentResult> {
```

Then replace the `if (best && best.score >= STORY_SIM_THRESHOLD) { ... }` block with:

```typescript
  if (best && best.score >= STORY_SIM_THRESHOLD) {
    // Vector match is sufficient. Only consult the LLM adjudicator if one was
    // explicitly supplied (default path passes none — clustering is LLM-free).
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run story-assignment`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/server/story-assignment.ts lib/server/story-assignment.test.ts
git commit -m "feat: vector-only story assignment, raise threshold to 0.83, adjudicator optional"
```

---

## Task 3: Strip per-article LLM from enrichment + guard test

**Files:**
- Modify: `lib/server/articles-repository.ts:781-815`
- Test: `lib/server/articles-repository.enrich.test.ts`

- [ ] **Step 1: Write the guard test**

```typescript
// lib/server/articles-repository.enrich.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const generateText = vi.fn(async () => ({ text: 'SHOULD NOT BE CALLED' }));
const embedText = vi.fn(async () => [1, 0, 0]);
vi.mock('@/lib/ai/providers', () => ({ generateText, embedText }));

// Deterministic dependencies are stubbed so the test focuses on "no LLM".
vi.mock('./settings-repository', () => ({
  getServerAISettings: () => ({ enabled: true, provider: 'ollama', model: 'gemma3:12b', embedModel: 'nomic-embed-text' }),
}));
vi.mock('./article-vectors-repository', () => ({ upsertArticleVector: vi.fn(), findNearestArticles: vi.fn(() => []) }));
vi.mock('./story-assignment', () => ({ assignArticleToStory: vi.fn(async () => ({ storyId: 's', created: true })), createLLMAdjudicator: vi.fn() }));

import { enrichArticleWithAI } from './articles-repository';

beforeEach(() => { generateText.mockClear(); embedText.mockClear(); });

describe('enrichArticleWithAI (LLM-free hot path)', () => {
  it('embeds and assigns but never calls generateText', async () => {
    await enrichArticleWithAI({
      articleId: 'a1', title: 'Fed holds rates', contentSnippet: 'snippet', rawContent: 'body',
      occurredAt: new Date().toISOString(),
    });
    expect(embedText).toHaveBeenCalledTimes(1);
    expect(generateText).not.toHaveBeenCalled();
  });
});
```

> Note: if `enrichArticleWithAI`'s deterministic entity/metadata writes require additional repositories, stub them in this test the same way (mock to no-ops). The assertion that matters is `generateText` is never called.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run articles-repository.enrich`
Expected: FAIL — `generateText` is called (via `extractEntitiesLLM`).

- [ ] **Step 3: Remove the two LLM calls from `enrichArticleWithAI`**

In `lib/server/articles-repository.ts`, replace lines 781–815 (the "LLM entities" try-block and the story-assignment try-block) with:

```typescript
  // Deterministic entities (regex/gazetteer) — no LLM in the hot path.
  try {
    const entities = extractEntities(article.title, content);
    upsertEntitiesForArticle(article.articleId, article.occurredAt, entities);
  } catch (error) {
    console.error(`[enrich] entity extraction failed for ${article.articleId}:`, error);
  }

  // Story assignment (best-effort, vector-only — no adjudicator). Needs an embedding.
  if (embedding && embedding.length > 0) {
    try {
      const result = await assignArticleToStory({
        articleId: article.articleId,
        title: article.title,
        snippet: (article.contentSnippet || '').slice(0, 400),
        occurredAt: article.occurredAt,
        embedding,
      });
      // Refresh deterministic mapping fields for the affected story.
      applyDeterministicMetadata(result.storyId);
    } catch (error) {
      console.error(`[enrich] story assignment failed for ${article.articleId}:`, error);
    }
  }
```

- [ ] **Step 4: Fix imports in `articles-repository.ts`**

- Confirm `extractEntities` is imported from `./intelligence` (it is — line 7). Remove the now-unused `extractEntitiesLLM` import (line 18) and the `createLLMAdjudicator` import if unused (line 22 keeps `assignArticleToStory`).
- Add an import for the deterministic refresh helper near the other repository imports:

```typescript
import { applyDeterministicMetadata } from './story-metadata';
```

- [ ] **Step 5: Add `applyDeterministicMetadata` to the metadata module**

Append to `lib/server/story-metadata.ts` (reuse the `getDb` already imported at the top of the file — do **not** add a second import):

```typescript
/**
 * Write deterministic actors + trajectory onto a story row. Does NOT touch the
 * LLM-owned `summary`/`stakes`/`title` fields when a summary already exists — those
 * are filled only for top board stories. For stories without an LLM summary yet,
 * actors/trajectory are the displayed values.
 */
export function applyDeterministicMetadata(storyId: string): void {
  const db = getDb();
  const actors = buildDeterministicActors(storyId);
  const trajectory = computeTrajectory(storyId);
  db.prepare(`UPDATE stories SET actors_json = ?, trajectory = ? WHERE id = ?`)
    .run(actors.length ? JSON.stringify(actors) : null, trajectory, storyId);
}
```

- [ ] **Step 6: Run the guard test + typecheck**

Run: `npx vitest run articles-repository.enrich && npx tsc --noEmit`
Expected: PASS; tsc exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/server/articles-repository.ts lib/server/story-metadata.ts lib/server/articles-repository.enrich.test.ts
git commit -m "feat: LLM-free per-article enrichment (deterministic entities + metadata)"
```

---

## Task 4: Gate LLM story summaries to the top-N board ranking

**Files:**
- Modify: `lib/server/stories-repository.ts:436-446` (gating query) and add `ensureStorySummary`
- Modify: `lib/server/background-worker.ts:136-144`

- [ ] **Step 1: Gate `regenerateDirtyStorySummaries` to top-N board order**

In `lib/server/stories-repository.ts`, change the dirty-selection query (lines 441–446) to match the board ranking and cap at the warm count:

```typescript
  const WARM_TOP_N = 5;
  const dirty = db.prepare(`
    SELECT id, title, summary, one_liner, actors_json, trajectory, stakes,
           open_questions, contradictions, summary_updated_at AS summaryUpdatedAt
    FROM stories
    WHERE summary_dirty_count >= ? AND status != 'closed'
    ORDER BY COALESCE(pinned, 0) DESC, salience DESC, last_updated DESC
    LIMIT ?
  `).all(threshold, WARM_TOP_N) as Array<{
    id: string; title: string; summary: string | null; one_liner: string | null;
    actors_json: string | null; trajectory: string | null; stakes: string | null;
    open_questions: string | null; contradictions: string | null; summaryUpdatedAt: string | null;
  }>;
```

- [ ] **Step 2: Extract the single-story summary into `ensureStorySummary` (for lazy reuse)**

The body of the `for (const story of dirty)` loop generates one story's summary. Extract that work into an exported function so the lazy path can reuse it. Add to `lib/server/stories-repository.ts`:

```typescript
/**
 * Generate (or refresh) the LLM situation brief for a single story, if it is dirty
 * or has no summary yet. Used by the worker (warm top-N) and the lazy board path
 * (ranks 6-12 on first view). Returns true if it produced a summary.
 */
export async function ensureStorySummary(storyId: string, force = false): Promise<boolean> {
  const db = getDb();
  const settings = getServerAISettings();
  if (!settings.enabled) return false;

  const story = db.prepare(`
    SELECT id, title, summary, one_liner, actors_json, trajectory, stakes,
           open_questions, contradictions, summary_dirty_count AS dirty,
           summary_updated_at AS summaryUpdatedAt
    FROM stories WHERE id = ? AND status != 'closed'
  `).get(storyId) as {
    id: string; title: string; summary: string | null; one_liner: string | null;
    actors_json: string | null; trajectory: string | null; stakes: string | null;
    open_questions: string | null; contradictions: string | null;
    dirty: number; summaryUpdatedAt: string | null;
  } | undefined;
  if (!story) return false;
  if (!force && story.dirty === 0 && story.summary) return false;

  return generateStorySummaryRow(db, story);
}
```

Move the per-story body (the `isFirstSummary` branch + incremental branch + `update.run(...)`) into a private `generateStorySummaryRow(db, story): Promise<boolean>` that returns `true` when it writes a summary, and have the `regenerateDirtyStorySummaries` loop call it. This is a pure refactor — the prompts and `update` statement are unchanged.

- [ ] **Step 3: Run existing story tests to confirm the refactor is behavior-preserving**

Run: `npx vitest run stories-repository`
Expected: PASS (existing tests unchanged in behavior).

- [ ] **Step 4: Add deterministic-metadata refresh to the worker idle pass**

In `lib/server/background-worker.ts`, inside `runRollingMaintenanceIfIdle`'s "story maintenance" pass (around line 136-144), add a deterministic refresh for active stories before the gated LLM pass:

```typescript
    await runMaintenancePass('story maintenance', async () => {
      const stories = await import('./stories-repository');
      const meta = await import('./story-metadata');
      // Deterministic mapping fields for ALL active stories (cheap, no LLM).
      const refreshed = stories.getRankedStories(50).reduce((n, s) => {
        meta.applyDeterministicMetadata(s.id);
        return n + 1;
      }, 0);
      // LLM summaries only for the dirty top-N (threshold=1 → any new assignment).
      const summarized = await stories.regenerateDirtyStorySummaries(1);
      const dormant = stories.transitionStaleStoriesToDormant();
      if (summarized > 0 || dormant > 0 || refreshed > 0) {
        console.log(`[IntelliDeck worker] Stories: ${refreshed} meta, ${summarized} summarized, ${dormant} -> dormant.`);
      }
    });
```

> Confirm `getRankedStories(limit)` exists (it does — `stories-repository.ts:366`) and returns objects with `.id`.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/server/stories-repository.ts lib/server/background-worker.ts
git commit -m "feat: gate LLM story summaries to top-5 warm; deterministic metadata for the rest"
```

---

## Task 5: Lazy summary on story-detail fetch (ranks 6-12)

**Files:**
- Modify: `app/api/stories/[id]/route.ts`

- [ ] **Step 1: Read the current route**

Run: `sed -n '1,60p' app/api/stories/[id]/route.ts`
Expected: a `GET` handler that calls `getStoryDetail(id)`.

- [ ] **Step 2: Trigger lazy summary before returning detail**

In the `GET` handler, before building the response, ensure the summary exists (best-effort; never block the response on failure):

```typescript
  const { ensureStorySummary, getStoryDetail } = await import('@/lib/server/stories-repository');
  try {
    await ensureStorySummary(id); // generates on first view if dirty / missing
  } catch (error) {
    console.error(`[stories/${id}] lazy summary failed:`, error);
  }
  const detail = getStoryDetail(id);
```

> Keep the existing import style of the file (static import vs dynamic). If the file already imports `getStoryDetail` statically, add `ensureStorySummary` to that import and drop the dynamic import above.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/api/stories/[id]/route.ts
git commit -m "feat: lazily generate story summary on first detail view"
```

---

## Task 6: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: all tests pass (story-metadata, story-assignment, articles-repository.enrich, stories-repository, plus existing suites).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Live smoke test (dev server on :3001 + LAN Ollama)**

With `npm run dev` running and articles ingesting, watch the DB for ~3 minutes:

```bash
DB="$HOME/Library/Application Support/IntelliDeckDev/data/intellideck.db"
sqlite3 -readonly "$DB" "SELECT 'articles '||MAX(created_at), 'story_art '||MAX(added_at) FROM articles, story_articles;"
```

Expected: `story_articles.added_at` keeps pace with `articles.created_at` (no lag), confirming the per-article path no longer waits on the LLM.

- [ ] **Step 4: Confirm interactive LLM is free during ingestion**

Run (sandbox off): `curl -s -N -m 30 http://192.168.68.59:11434/api/generate -d '{"model":"gemma3:12b","prompt":"hi","stream":true,"options":{"num_predict":3}}'`
Expected: tokens within ~1-2s even while ingesting — the slot is no longer monopolized by per-article calls.

- [ ] **Step 5: Final commit (if any cleanup)**

```bash
git add -A && git commit -m "chore: LLM-minimized pipeline cleanup"
```

---

## Spec coverage notes (deterministic fields already satisfied by existing code)

The spec lists "Title" and "extractive one-liner" as deterministic story-metadata
fields. These need **no new task** — existing mechanisms already cover them:

- **Title:** `createStory(input.title)` already sets a story's title to its first
  (earliest) member article's title — deterministic, matching the spec's "falling
  back to the earliest" rule. Top board stories get an LLM-refined title via the
  narrative brief. The "highest-salience member article" preference is an optional
  future refinement (deferred — `articles` has no per-article salience column to key
  on, and applying it for all stories would clobber LLM titles for top stories).
- **Extractive one-liner:** `getSituationBoard` already derives `oneLiner` as
  `COALESCE(one_liner, latest story_event summary)` (stories-repository.ts:270).
  Story events are created deterministically from article snippets on assignment, so
  the long-tail one-liner is already extractive with no LLM.

## Notes for the implementer

- The pre-existing 3 failing `story-assignment` tests (missing `summary_updated_at` column) are **replaced** by Task 2's rewrite — the spawned cleanup task for them becomes moot.
- Do not change the world-synthesis or daily-briefing modules — they are already correctly scoped LLM users.
- `getDb`, `getServerAISettings`, `attachArticleToStory`, `createStory`, `getStoryById`, `getActiveStoryCentroids`, `getRankedStories`, `transitionStaleStoriesToDormant`, `extractEntities`, `upsertEntitiesForArticle`, `upsertArticleVector`, `truncateForOllama` all already exist — reuse, do not recreate.
