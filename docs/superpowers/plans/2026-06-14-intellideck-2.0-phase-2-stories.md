# IntelliDeck 2.0 — Phase 2: Stories & Temporal Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cluster enriched articles into evolving **stories** with a timeline of events, track "what changed since you last read", and make the **Story view take over the Today screen** (demoting the Agent chat to an on-demand panel).

**Architecture:** Build on Phase 1's per-article embeddings (`article_vectors`) and enrichment queue. After an article is embedded, assign it to a story by cosine-comparing its embedding against recent non-closed story centroids (running mean, stored as JSON); above a similarity threshold an LLM adjudicates "same story?" before merging, else a new story is created. Each attach appends a `story_events` row. Story titles/summaries and developing→dormant status are maintained by debounced jobs on the existing worker tick. The UI adds a reusable `StoryCard`; Today becomes a ranked story feed + story detail with a "since you last read" diff, and the Agent panel becomes a slide-in summoned from a story/article.

**Tech Stack:** `node:sqlite` (`DatabaseSync`) + `sqlite-vec` + Ollama (`gemma4:12b-mlx` for adjudication/summaries via `generateText`, `nomic-embed-text` embeddings) + Next.js App Router + React + Vitest. Reuses Phase 1: `findNearestArticles`/`upsertArticleVector` ([lib/server/article-vectors-repository.ts](../../../lib/server/article-vectors-repository.ts)), `enrichArticleWithAI` ([lib/server/articles-repository.ts:648](../../../lib/server/articles-repository.ts)), `getServerAISettings` ([lib/server/settings-repository.ts](../../../lib/server/settings-repository.ts)), `generateText` + `AIRequestOptions.numCtx` ([lib/ai/providers.ts](../../../lib/ai/providers.ts)), `computeNumCtx`/`truncateForOllama` ([lib/ai/ollama-utils.ts](../../../lib/ai/ollama-utils.ts)).

**Constants (tune later):** similarity threshold `0.78`; dormant after `3` days of no new article; story summary/title regenerated when `>= 3` new events accumulate.

**Done when:** a multi-article story collapses into one evolving timeline on the Today screen, returning to it highlights events newer than your last view, and the Agent is reachable as a slide-in from a story/article.

---

## Stage map & execution checkpoint

- **Stage A (Tasks 1–6): Story graph backend** — schema, vector math, stories repository, assignment wired into enrichment.
- **Stage B (Tasks 7–9): Temporal memory & maintenance** — story titles/summaries (debounced), developing→dormant transitions, "since you last read".
- **Stage C (Tasks 10–15): UI** — story APIs, `StoryCard`, Today→Stories takeover, Agent demotion, raw-feed Stories⇄Raw toggle.

**Natural checkpoint:** after Stage B the backend is complete and testable headless. Review there before Stage C (the UI takeover touches recently-committed Today code).

---

## File Structure

**Create:**
- `lib/server/vector-math.ts` + `.test.ts` — pure cosine similarity / mean helpers.
- `lib/server/stories-repository.ts` + tests — story CRUD, centroid running-mean, events, status, reads, ranked queries.
- `lib/server/story-assignment.ts` + `.test.ts` — pick-or-create story for an article given its embedding (with LLM adjudication, injectable).
- `app/api/stories/route.ts` — ranked story list.
- `app/api/stories/[id]/route.ts` — story detail + "since you last read".
- `app/api/stories/[id]/view/route.ts` — mark story viewed.
- `components/deck/StoryCard.tsx` — collapsed/expandable story card with timeline.
- `components/StoriesFeed.tsx` — ranked story list + selected story detail (used by Today).
- `components/ui/AgentDrawer.tsx` — slide-in wrapper around the existing Agent panel.

**Modify:**
- `lib/server/db.ts` — add `stories`, `story_articles`, `story_events`, `story_reads` tables + `story_vectors` is NOT used (centroids live in `stories.centroid` JSON).
- `lib/server/articles-repository.ts` — call story assignment from `enrichArticleWithAI` using the embedding already computed.
- `lib/server/background-worker.ts` — call story summary + dormant-transition jobs on the tick.
- `components/TodayWorkspace.tsx` — replace the Agent column with `StoriesFeed`; mount `AgentDrawer`.
- `app/raw-feed/*` (the deck page) — add a Stories⇄Raw toggle rendering `StoryCard`s.
- `lib/i18n/en.json`, `lib/i18n/zh-CN.json` — story/temporal strings.

---

## Task 1: Pure vector math helpers

**Files:**
- Create: `lib/server/vector-math.ts`
- Test: `lib/server/vector-math.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/server/vector-math.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cosineSimilarity, runningMean } from './vector-math';

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it('returns 0 when either vector is zero-length or empty', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([], [1])).toBe(0);
  });
});

describe('runningMean', () => {
  it('returns the new vector when count is 0', () => {
    expect(runningMean(null, [1, 2], 0)).toEqual([1, 2]);
  });
  it('incrementally averages', () => {
    // mean of [0,0] (n=1) and [2,2] -> [1,1]
    expect(runningMean([0, 0], [2, 2], 1)).toEqual([1, 1]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/server/vector-math.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `lib/server/vector-math.ts`:

```ts
import 'server-only';

/** Cosine similarity in [-1, 1]; returns 0 if either vector is empty/zero/length-mismatched. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Incrementally fold `next` into a running mean.
 * @param current existing mean (or null when count is 0)
 * @param next the new vector to add
 * @param count number of vectors already represented by `current`
 */
export function runningMean(current: number[] | null, next: number[], count: number): number[] {
  if (!current || count <= 0) return [...next];
  return current.map((v, i) => (v * count + next[i]) / (count + 1));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/server/vector-math.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/vector-math.ts lib/server/vector-math.test.ts
git commit -m "feat: add pure vector-math helpers (cosine, running mean)"
```

---

## Task 2: Stories schema

**Files:**
- Modify: `lib/server/db.ts` (schema `db.exec` block, near the `article_vectors` table added in Phase 1)

- [ ] **Step 1: Add the tables**

In `lib/server/db.ts`, inside the big `db.exec(\`...\`)` schema string, immediately after the `CREATE VIRTUAL TABLE IF NOT EXISTS article_vectors ...` block (added in Phase 1), add:

```sql
    CREATE TABLE IF NOT EXISTS stories (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'developing',
      summary       TEXT,
      centroid      TEXT,                 -- JSON array (running-mean embedding)
      article_count INTEGER NOT NULL DEFAULT 0,
      salience      REAL NOT NULL DEFAULT 0,
      summary_dirty_count INTEGER NOT NULL DEFAULT 0,
      first_seen    TEXT NOT NULL,
      last_updated  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS story_articles (
      story_id   TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      added_at   TEXT NOT NULL,
      PRIMARY KEY (story_id, article_id)
    );

    CREATE TABLE IF NOT EXISTS story_events (
      id          TEXT PRIMARY KEY,
      story_id    TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      occurred_at TEXT NOT NULL,
      summary     TEXT NOT NULL,
      article_id  TEXT REFERENCES articles(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS story_reads (
      story_id      TEXT PRIMARY KEY REFERENCES stories(id) ON DELETE CASCADE,
      last_viewed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_story_articles_article ON story_articles(article_id);
    CREATE INDEX IF NOT EXISTS idx_story_events_story ON story_events(story_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_stories_status_salience ON stories(status, salience DESC);
```

- [ ] **Step 2: Verify the app still boots and creates tables**

Run: `npm run build` is not required here; instead verify the SQL parses by running the existing suite (db.ts is imported by repository tests through mocks, but a direct parse check is fastest):

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const v = require('sqlite-vec');
const d = new DatabaseSync(':memory:', { allowExtension: true });
d.enableLoadExtension(true); d.loadExtension(v.getLoadablePath()); d.enableLoadExtension(false);
d.exec(\`
  CREATE TABLE articles (id TEXT PRIMARY KEY);
  CREATE TABLE stories (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'developing', summary TEXT, centroid TEXT, article_count INTEGER NOT NULL DEFAULT 0, salience REAL NOT NULL DEFAULT 0, summary_dirty_count INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_updated TEXT NOT NULL);
  CREATE TABLE story_articles (story_id TEXT, article_id TEXT, added_at TEXT NOT NULL, PRIMARY KEY (story_id, article_id));
  CREATE TABLE story_events (id TEXT PRIMARY KEY, story_id TEXT NOT NULL, occurred_at TEXT NOT NULL, summary TEXT NOT NULL, article_id TEXT);
  CREATE TABLE story_reads (story_id TEXT PRIMARY KEY, last_viewed_at TEXT NOT NULL);
\`);
console.log('schema OK');
" 2>&1 | grep -v Warning
```
Expected: prints `schema OK`.

- [ ] **Step 3: Commit**

```bash
git add lib/server/db.ts
git commit -m "feat: add stories/story_articles/story_events/story_reads tables"
```

---

## Task 3: Stories repository — create & attach with running-mean centroid

**Files:**
- Create: `lib/server/stories-repository.ts`
- Test: `lib/server/stories-repository.test.ts`

> All ids use `nanoid` and timestamps are ISO strings, matching Phase 1 conventions. Centroids are stored as `JSON.stringify(number[])` in `stories.centroid`.

- [ ] **Step 1: Write the failing test**

Create `lib/server/stories-repository.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE stories (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'developing',
    summary TEXT, centroid TEXT, article_count INTEGER NOT NULL DEFAULT 0, salience REAL NOT NULL DEFAULT 0,
    summary_dirty_count INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_updated TEXT NOT NULL);
  CREATE TABLE story_articles (story_id TEXT, article_id TEXT, added_at TEXT NOT NULL, PRIMARY KEY (story_id, article_id));
  CREATE TABLE story_events (id TEXT PRIMARY KEY, story_id TEXT NOT NULL, occurred_at TEXT NOT NULL, summary TEXT NOT NULL, article_id TEXT);
`);
vi.mock('./db', () => ({ getDb: () => db }));

import { createStory, attachArticleToStory, getActiveStoryCentroids, getStoryById } from './stories-repository';

beforeEach(() => {
  db.exec('DELETE FROM stories; DELETE FROM story_articles; DELETE FROM story_events;');
});

describe('stories-repository', () => {
  it('creates a story seeded by an article with centroid = article embedding', () => {
    const id = createStory({
      title: 'Quake hits region', articleId: 'a1', occurredAt: '2026-06-14T00:00:00.000Z',
      embedding: [1, 0, 0], eventSummary: 'Initial report',
    });
    const story = getStoryById(id)!;
    expect(story.title).toBe('Quake hits region');
    expect(story.status).toBe('developing');
    expect(story.articleCount).toBe(1);
    expect(JSON.parse(story.centroid!)).toEqual([1, 0, 0]);
    const events = db.prepare('SELECT * FROM story_events WHERE story_id=?').all(id);
    expect(events).toHaveLength(1);
  });

  it('attaches a second article, folds the centroid, bumps count and dirty', () => {
    const id = createStory({ title: 'T', articleId: 'a1', occurredAt: '2026-06-14T00:00:00.000Z', embedding: [0, 0], eventSummary: 'e1' });
    attachArticleToStory({ storyId: id, articleId: 'a2', occurredAt: '2026-06-15T00:00:00.000Z', embedding: [2, 2], eventSummary: 'e2' });
    const story = getStoryById(id)!;
    expect(story.articleCount).toBe(2);
    expect(JSON.parse(story.centroid!)).toEqual([1, 1]);
    expect(story.lastUpdated).toBe('2026-06-15T00:00:00.000Z');
    expect(story.summaryDirtyCount).toBe(2);
    expect(db.prepare('SELECT COUNT(*) c FROM story_events WHERE story_id=?').get(id)).toEqual({ c: 2 });
  });

  it('is idempotent if the same article is attached twice (no double count)', () => {
    const id = createStory({ title: 'T', articleId: 'a1', occurredAt: 't', embedding: [1], eventSummary: 'e' });
    attachArticleToStory({ storyId: id, articleId: 'a1', occurredAt: 't', embedding: [1], eventSummary: 'e' });
    expect(getStoryById(id)!.articleCount).toBe(1);
  });

  it('getActiveStoryCentroids returns non-closed stories with parsed centroids', () => {
    const id = createStory({ title: 'T', articleId: 'a1', occurredAt: 't', embedding: [1, 2], eventSummary: 'e' });
    db.prepare("UPDATE stories SET status='closed' WHERE id=?").run(createStory({ title: 'C', articleId: 'a2', occurredAt: 't', embedding: [9, 9], eventSummary: 'e' }));
    const active = getActiveStoryCentroids(50);
    expect(active.map((s) => s.id)).toEqual([id]);
    expect(active[0].centroid).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/server/stories-repository.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `lib/server/stories-repository.ts`:

```ts
import 'server-only';

import { nanoid } from 'nanoid';
import { getDb } from './db';
import { runningMean } from './vector-math';

export interface StoryRow {
  id: string;
  title: string;
  status: 'developing' | 'dormant' | 'closed';
  summary: string | null;
  centroid: string | null;
  articleCount: number;
  salience: number;
  summaryDirtyCount: number;
  firstSeen: string;
  lastUpdated: string;
}

export interface ActiveStoryCentroid {
  id: string;
  centroid: number[];
  articleCount: number;
  lastUpdated: string;
}

export function createStory(input: {
  title: string;
  articleId: string;
  occurredAt: string;
  embedding: number[];
  eventSummary: string;
}): string {
  const db = getDb();
  const id = nanoid();
  db.prepare(`
    INSERT INTO stories (id, title, status, centroid, article_count, salience, summary_dirty_count, first_seen, last_updated)
    VALUES (?, ?, 'developing', ?, 1, 1, 1, ?, ?)
  `).run(id, input.title, JSON.stringify(input.embedding), input.occurredAt, input.occurredAt);
  db.prepare('INSERT OR IGNORE INTO story_articles (story_id, article_id, added_at) VALUES (?, ?, ?)')
    .run(id, input.articleId, input.occurredAt);
  db.prepare('INSERT INTO story_events (id, story_id, occurred_at, summary, article_id) VALUES (?, ?, ?, ?, ?)')
    .run(nanoid(), id, input.occurredAt, input.eventSummary, input.articleId);
  return id;
}

export function attachArticleToStory(input: {
  storyId: string;
  articleId: string;
  occurredAt: string;
  embedding: number[];
  eventSummary: string;
}): void {
  const db = getDb();
  const story = getStoryById(input.storyId);
  if (!story) return;

  const link = db.prepare('INSERT OR IGNORE INTO story_articles (story_id, article_id, added_at) VALUES (?, ?, ?)')
    .run(input.storyId, input.articleId, input.occurredAt) as { changes: number };
  if (link.changes === 0) return; // already attached: no double-count

  const current = story.centroid ? (JSON.parse(story.centroid) as number[]) : null;
  const nextCentroid = runningMean(current, input.embedding, story.articleCount);

  db.prepare(`
    UPDATE stories
    SET centroid = ?, article_count = article_count + 1,
        last_updated = ?, status = 'developing',
        summary_dirty_count = summary_dirty_count + 1,
        salience = salience + 1
    WHERE id = ?
  `).run(JSON.stringify(nextCentroid), input.occurredAt, input.storyId);

  db.prepare('INSERT INTO story_events (id, story_id, occurred_at, summary, article_id) VALUES (?, ?, ?, ?, ?)')
    .run(nanoid(), input.storyId, input.occurredAt, input.eventSummary, input.articleId);
}

export function getStoryById(id: string): StoryRow | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, title, status, summary, centroid,
           article_count AS articleCount, salience,
           summary_dirty_count AS summaryDirtyCount,
           first_seen AS firstSeen, last_updated AS lastUpdated
    FROM stories WHERE id = ?
  `).get(id) as StoryRow | undefined;
  return row ?? null;
}

/** Non-closed stories (most recently updated first), with parsed centroids, for candidate matching. */
export function getActiveStoryCentroids(limit: number): ActiveStoryCentroid[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, centroid, article_count AS articleCount, last_updated AS lastUpdated
    FROM stories
    WHERE status != 'closed' AND centroid IS NOT NULL
    ORDER BY last_updated DESC
    LIMIT ?
  `).all(limit) as Array<{ id: string; centroid: string; articleCount: number; lastUpdated: string }>;
  return rows.map((r) => ({ id: r.id, centroid: JSON.parse(r.centroid) as number[], articleCount: r.articleCount, lastUpdated: r.lastUpdated }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/server/stories-repository.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/stories-repository.ts lib/server/stories-repository.test.ts
git commit -m "feat: stories repository (create/attach, running-mean centroid, events)"
```

---

## Task 4: Story assignment (pick-or-create with injectable adjudicator)

**Files:**
- Create: `lib/server/story-assignment.ts`
- Test: `lib/server/story-assignment.test.ts`

> The LLM adjudicator is injected so it can be tested deterministically and mocked in production wiring (Task 6).

- [ ] **Step 1: Write the failing test**

Create `lib/server/story-assignment.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE stories (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'developing',
    summary TEXT, centroid TEXT, article_count INTEGER NOT NULL DEFAULT 0, salience REAL NOT NULL DEFAULT 0,
    summary_dirty_count INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_updated TEXT NOT NULL);
  CREATE TABLE story_articles (story_id TEXT, article_id TEXT, added_at TEXT NOT NULL, PRIMARY KEY (story_id, article_id));
  CREATE TABLE story_events (id TEXT PRIMARY KEY, story_id TEXT NOT NULL, occurred_at TEXT NOT NULL, summary TEXT NOT NULL, article_id TEXT);
`);
vi.mock('./db', () => ({ getDb: () => db }));

import { assignArticleToStory } from './story-assignment';
import { getStoryById, createStory } from './stories-repository';

beforeEach(() => { db.exec('DELETE FROM stories; DELETE FROM story_articles; DELETE FROM story_events;'); });

const yes = async () => true;
const no = async () => false;

describe('assignArticleToStory', () => {
  it('creates a new story when there are no candidates', async () => {
    const r = await assignArticleToStory({
      articleId: 'a1', title: 'Big quake', snippet: 's', occurredAt: 't', embedding: [1, 0, 0],
    }, { adjudicate: yes });
    expect(r.created).toBe(true);
    expect(getStoryById(r.storyId)!.articleCount).toBe(1);
  });

  it('attaches to a similar story when above threshold and adjudicator says yes', async () => {
    const existing = createStory({ title: 'Quake', articleId: 'a0', occurredAt: 't', embedding: [1, 0, 0], eventSummary: 'e' });
    const r = await assignArticleToStory({
      articleId: 'a1', title: 'Quake aftermath', snippet: 's', occurredAt: 't2', embedding: [0.99, 0.01, 0],
    }, { adjudicate: yes });
    expect(r.created).toBe(false);
    expect(r.storyId).toBe(existing);
    expect(getStoryById(existing)!.articleCount).toBe(2);
  });

  it('creates a new story when similar but adjudicator says no (bias against false merge)', async () => {
    createStory({ title: 'Quake', articleId: 'a0', occurredAt: 't', embedding: [1, 0, 0], eventSummary: 'e' });
    const r = await assignArticleToStory({
      articleId: 'a1', title: 'Different topic', snippet: 's', occurredAt: 't2', embedding: [0.99, 0.01, 0],
    }, { adjudicate: no });
    expect(r.created).toBe(true);
  });

  it('creates a new story when below threshold (no adjudication call)', async () => {
    createStory({ title: 'Quake', articleId: 'a0', occurredAt: 't', embedding: [1, 0, 0], eventSummary: 'e' });
    const adjudicate = vi.fn(async () => true);
    const r = await assignArticleToStory({
      articleId: 'a1', title: 'Unrelated', snippet: 's', occurredAt: 't2', embedding: [0, 1, 0],
    }, { adjudicate });
    expect(r.created).toBe(true);
    expect(adjudicate).not.toHaveBeenCalled();
  });

  it('skips entirely when embedding is empty', async () => {
    const r = await assignArticleToStory({
      articleId: 'a1', title: 'x', snippet: 's', occurredAt: 't', embedding: [],
    }, { adjudicate: yes });
    expect(r.skipped).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/server/story-assignment.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `lib/server/story-assignment.ts`:

```ts
import 'server-only';

import { cosineSimilarity } from './vector-math';
import {
  createStory,
  attachArticleToStory,
  getActiveStoryCentroids,
  getStoryById,
} from './stories-repository';

export const STORY_SIM_THRESHOLD = 0.78;
const CANDIDATE_LIMIT = 100;
const RECENCY_HALF_LIFE_DAYS = 7;

export interface AssignArticleInput {
  articleId: string;
  title: string;
  snippet: string;
  occurredAt: string;
  embedding: number[];
}

export interface Adjudicator {
  /** Decide whether `input` belongs to the candidate story (given its title/summary). */
  adjudicate: (input: AssignArticleInput, candidate: { title: string; summary: string | null }) => Promise<boolean>;
}

export interface AssignmentResult {
  storyId: string;
  created: boolean;
  skipped?: boolean;
}

function recencyWeight(lastUpdated: string, now: number): number {
  const ageDays = Math.max(0, (now - Date.parse(lastUpdated)) / 86_400_000);
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

export async function assignArticleToStory(
  input: AssignArticleInput,
  deps: Adjudicator,
): Promise<AssignmentResult> {
  if (!input.embedding || input.embedding.length === 0) {
    return { storyId: '', created: false, skipped: true };
  }

  const candidates = getActiveStoryCentroids(CANDIDATE_LIMIT);
  const now = Date.now();

  let best: { id: string; score: number } | null = null;
  for (const candidate of candidates) {
    const sim = cosineSimilarity(input.embedding, candidate.centroid);
    const weighted = sim * recencyWeight(candidate.lastUpdated, now);
    if (!best || weighted > best.score) best = { id: candidate.id, score: weighted };
  }

  const eventSummary = input.snippet?.trim() || input.title;

  if (best && best.score >= STORY_SIM_THRESHOLD) {
    const story = getStoryById(best.id);
    const sameStory = story
      ? await deps.adjudicate(input, { title: story.title, summary: story.summary })
      : false;
    if (story && sameStory) {
      attachArticleToStory({
        storyId: story.id,
        articleId: input.articleId,
        occurredAt: input.occurredAt,
        embedding: input.embedding,
        eventSummary,
      });
      return { storyId: story.id, created: false };
    }
  }

  const storyId = createStory({
    title: input.title,
    articleId: input.articleId,
    occurredAt: input.occurredAt,
    embedding: input.embedding,
    eventSummary,
  });
  return { storyId, created: true };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/server/story-assignment.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/story-assignment.ts lib/server/story-assignment.test.ts
git commit -m "feat: story assignment (cosine match + injectable LLM adjudication)"
```

---

## Task 5: LLM adjudicator backed by the provider layer

**Files:**
- Modify: `lib/server/story-assignment.ts` (add `createLLMAdjudicator`)
- Test: `lib/server/story-assignment.adjudicator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/server/story-assignment.adjudicator.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));
const generateText = vi.fn();
vi.mock('@/lib/ai/providers', () => ({ generateText: (...a: unknown[]) => generateText(...a) }));

import { createLLMAdjudicator } from './story-assignment';

afterEach(() => vi.resetAllMocks());
const ai = { provider: 'ollama' as const, model: 'gemma4:12b-mlx', baseUrl: undefined, apiKey: undefined };

describe('createLLMAdjudicator', () => {
  it('returns true when the model answers yes', async () => {
    generateText.mockResolvedValue({ text: 'YES - same earthquake story' });
    const adj = createLLMAdjudicator(ai).adjudicate;
    const r = await adj(
      { articleId: 'a', title: 'Quake aftermath', snippet: 's', occurredAt: 't', embedding: [1] },
      { title: 'Quake', summary: 'A big quake' },
    );
    expect(r).toBe(true);
  });

  it('returns false on a no answer or unparseable output (bias against merge)', async () => {
    generateText.mockResolvedValue({ text: 'No, unrelated.' });
    const adj = createLLMAdjudicator(ai).adjudicate;
    expect(await adj({ articleId: 'a', title: 't', snippet: 's', occurredAt: 't', embedding: [1] }, { title: 'x', summary: null })).toBe(false);
  });

  it('returns false when the model call throws', async () => {
    generateText.mockRejectedValue(new Error('down'));
    const adj = createLLMAdjudicator(ai).adjudicate;
    expect(await adj({ articleId: 'a', title: 't', snippet: 's', occurredAt: 't', embedding: [1] }, { title: 'x', summary: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/server/story-assignment.adjudicator.test.ts`
Expected: FAIL (`createLLMAdjudicator` not exported).

- [ ] **Step 3: Implement**

Add to `lib/server/story-assignment.ts` (top imports + new export):

```ts
import { generateText, type AIProvider } from '@/lib/ai/providers';
```

```ts
export interface AdjudicatorAIOptions {
  provider: AIProvider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

/** LLM adjudicator: a single cheap yes/no, biased against false merges. */
export function createLLMAdjudicator(ai: AdjudicatorAIOptions): Adjudicator {
  return {
    adjudicate: async (input, candidate) => {
      const prompt = [
        'You decide whether a new article belongs to an existing news story.',
        'Answer with exactly YES or NO on the first line. Bias toward NO when uncertain.',
        '',
        `EXISTING STORY TITLE: ${candidate.title}`,
        `EXISTING STORY SUMMARY: ${candidate.summary ?? '(none yet)'}`,
        '',
        `NEW ARTICLE TITLE: ${input.title}`,
        `NEW ARTICLE SNIPPET: ${input.snippet}`,
        '',
        'Same ongoing story? YES or NO:',
      ].join('\n');
      try {
        const { text } = await generateText(ai.provider, prompt, {
          model: ai.model,
          baseUrl: ai.baseUrl,
          apiKey: ai.apiKey,
          temperature: 0,
          numCtx: 2048,
        });
        return /^\s*yes\b/i.test(text.trim());
      } catch {
        return false;
      }
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/server/story-assignment.adjudicator.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/story-assignment.ts lib/server/story-assignment.adjudicator.test.ts
git commit -m "feat: LLM story adjudicator (yes/no, biased against merges)"
```

---

## Task 6: Wire story assignment into enrichment

**Files:**
- Modify: `lib/server/articles-repository.ts` (`enrichArticleWithAI` at [lib/server/articles-repository.ts:648](../../../lib/server/articles-repository.ts))

> The embedding is already computed in `enrichArticleWithAI`. Capture it and feed story assignment after entities, best-effort and isolated.

- [ ] **Step 1: Add imports**

In `lib/server/articles-repository.ts`, with the other `./` imports near the top:

```ts
import { assignArticleToStory, createLLMAdjudicator } from './story-assignment';
```

- [ ] **Step 2: Capture the embedding and assign a story**

Replace the embedding `try` block and add a story-assignment block. The current code is:

```ts
  // Embedding (best-effort, isolated failure). Always via local Ollama.
  try {
    const embedInput = truncateForOllama(`${article.title}\n${content}`, 5000);
    const embedding = await embedText('ollama', embedInput, {
      model: settings.embedModel,
      baseUrl: settings.baseUrl,
    });
    upsertArticleVector(article.articleId, embedding);
  } catch (error) {
    console.error(`[enrich] embedding failed for ${article.articleId}:`, error);
  }
```

Change it to hoist `embedding` so it survives for story assignment:

```ts
  // Embedding (best-effort, isolated failure). Always via local Ollama.
  let embedding: number[] | null = null;
  try {
    const embedInput = truncateForOllama(`${article.title}\n${content}`, 5000);
    embedding = await embedText('ollama', embedInput, {
      model: settings.embedModel,
      baseUrl: settings.baseUrl,
    });
    upsertArticleVector(article.articleId, embedding);
  } catch (error) {
    console.error(`[enrich] embedding failed for ${article.articleId}:`, error);
  }
```

Then, after the existing LLM-entities `try/catch` block (after the line `console.error(\`[enrich] entity extraction failed for ${article.articleId}:\`, error);` and its closing brace), add:

```ts
  // Story assignment (best-effort). Needs an embedding to compare centroids.
  if (embedding && embedding.length > 0) {
    try {
      await assignArticleToStory(
        {
          articleId: article.articleId,
          title: article.title,
          snippet: (article.contentSnippet || '').slice(0, 400),
          occurredAt: article.occurredAt,
          embedding,
        },
        createLLMAdjudicator({
          provider: settings.provider,
          model: settings.model,
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
        }),
      );
    } catch (error) {
      console.error(`[enrich] story assignment failed for ${article.articleId}:`, error);
    }
  }
```

- [ ] **Step 3: Verify the suite still passes**

Run: `npm test`
Expected: all tests pass (no regressions; this file has no direct unit test, it's covered by Tasks 3–5 plus existing suite).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors (pre-existing `TodayAgentPanel` errors, if any remain, are out of scope).

- [ ] **Step 5: Commit**

```bash
git add lib/server/articles-repository.ts
git commit -m "feat: assign each enriched article to a story"
```

---

## Task 7: Story title + summary regeneration (debounced)

**Files:**
- Modify: `lib/server/stories-repository.ts` (add `regenerateDirtyStorySummaries`, `getStoryArticleTitles`)
- Test: `lib/server/stories-repository.summary.test.ts`

> Mirrors Phase 1's entity rolling-summary debounce: regenerate only when `summary_dirty_count >= threshold`. Generates BOTH a concise title and a rolling summary from member article titles + recent event summaries.

- [ ] **Step 1: Write the failing test**

Create `lib/server/stories-repository.summary.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE stories (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'developing',
    summary TEXT, centroid TEXT, article_count INTEGER NOT NULL DEFAULT 0, salience REAL NOT NULL DEFAULT 0,
    summary_dirty_count INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_updated TEXT NOT NULL);
  CREATE TABLE story_events (id TEXT PRIMARY KEY, story_id TEXT NOT NULL, occurred_at TEXT NOT NULL, summary TEXT NOT NULL, article_id TEXT);
`);
vi.mock('./db', () => ({ getDb: () => db }));
const generateText = vi.fn();
vi.mock('@/lib/ai/providers', () => ({ generateText: (...a: unknown[]) => generateText(...a) }));
vi.mock('./settings-repository', () => ({ getServerAISettings: () => ({ enabled: true, provider: 'ollama', model: 'gemma4:12b-mlx' }) }));

import { regenerateDirtyStorySummaries } from './stories-repository';

beforeEach(() => { db.exec('DELETE FROM stories; DELETE FROM story_events;'); generateText.mockReset(); });

describe('regenerateDirtyStorySummaries', () => {
  it('updates title+summary and clears dirty for stories at/above threshold', async () => {
    db.prepare("INSERT INTO stories (id,title,status,article_count,summary_dirty_count,first_seen,last_updated) VALUES ('s1','seed',' developing',3,3,'t','t')".replace("' developing'", "'developing'")).run();
    db.prepare("INSERT INTO story_events (id,story_id,occurred_at,summary) VALUES ('e1','s1','t','Quake hits coast')").run();
    generateText.mockResolvedValue({ text: 'TITLE: Coastal earthquake\nSUMMARY: A major quake struck the coast and aftershocks continue.' });
    const n = await regenerateDirtyStorySummaries(3);
    expect(n).toBe(1);
    const s = db.prepare("SELECT title, summary, summary_dirty_count FROM stories WHERE id='s1'").get() as Record<string, unknown>;
    expect(s.title).toBe('Coastal earthquake');
    expect(String(s.summary)).toContain('quake');
    expect(s.summary_dirty_count).toBe(0);
  });

  it('skips stories below threshold', async () => {
    db.prepare("INSERT INTO stories (id,title,status,article_count,summary_dirty_count,first_seen,last_updated) VALUES ('s2','seed','developing',1,1,'t','t')").run();
    const n = await regenerateDirtyStorySummaries(3);
    expect(n).toBe(0);
    expect(generateText).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/server/stories-repository.summary.test.ts`
Expected: FAIL (`regenerateDirtyStorySummaries` not exported).

- [ ] **Step 3: Implement**

Add to `lib/server/stories-repository.ts` (imports + functions):

```ts
import { generateText } from '@/lib/ai/providers';
import { getServerAISettings } from './settings-repository';
import { computeNumCtx } from '@/lib/ai/ollama-utils';
```

```ts
function parseTitleSummary(text: string, fallbackTitle: string): { title: string; summary: string } {
  const titleMatch = text.match(/TITLE:\s*(.+)/i);
  const summaryMatch = text.match(/SUMMARY:\s*([\s\S]+)/i);
  const title = titleMatch?.[1]?.trim().slice(0, 120) || fallbackTitle;
  const summary = summaryMatch?.[1]?.trim() || text.trim();
  return { title, summary };
}

export async function regenerateDirtyStorySummaries(threshold = 3): Promise<number> {
  const db = getDb();
  const settings = getServerAISettings();
  if (!settings.enabled) return 0;

  const dirty = db.prepare(`
    SELECT id, title FROM stories
    WHERE summary_dirty_count >= ? AND status != 'closed'
    ORDER BY salience DESC LIMIT 15
  `).all(threshold) as Array<{ id: string; title: string }>;

  const selectEvents = db.prepare(`
    SELECT summary FROM story_events WHERE story_id = ? ORDER BY occurred_at DESC LIMIT 15
  `);
  const update = db.prepare(`
    UPDATE stories SET title = ?, summary = ?, summary_dirty_count = 0 WHERE id = ?
  `);

  let updated = 0;
  for (const story of dirty) {
    const events = (selectEvents.all(story.id) as Array<{ summary: string }>).map((e) => e.summary);
    const prompt = [
      'Summarize this evolving news story from its developments below.',
      'Output exactly two lines:',
      'TITLE: <=8 word headline',
      'SUMMARY: 2-3 sentences synthesizing what is happening.',
      '',
      'DEVELOPMENTS:',
      ...events.map((e) => `- ${e}`),
    ].join('\n');
    try {
      const { text } = await generateText(settings.provider, prompt, {
        model: settings.model,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        temperature: 0.2,
        numCtx: Math.min(8192, computeNumCtx(prompt) + 1024),
      });
      const { title, summary } = parseTitleSummary(text, story.title);
      update.run(title, summary, story.id);
      updated += 1;
    } catch (error) {
      console.error(`[story-summary] failed for ${story.id}:`, error);
    }
  }
  return updated;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/server/stories-repository.summary.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/stories-repository.ts lib/server/stories-repository.summary.test.ts
git commit -m "feat: debounced story title+summary regeneration"
```

---

## Task 8: Developing→dormant transitions + worker wiring

**Files:**
- Modify: `lib/server/stories-repository.ts` (add `transitionStaleStoriesToDormant`)
- Modify: `lib/server/background-worker.ts` (call story jobs on the tick)
- Test: `lib/server/stories-repository.status.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/server/stories-repository.status.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE stories (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'developing',
  summary TEXT, centroid TEXT, article_count INTEGER NOT NULL DEFAULT 0, salience REAL NOT NULL DEFAULT 0,
  summary_dirty_count INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_updated TEXT NOT NULL);`);
vi.mock('./db', () => ({ getDb: () => db }));
vi.mock('@/lib/ai/providers', () => ({ generateText: vi.fn() }));
vi.mock('./settings-repository', () => ({ getServerAISettings: () => ({ enabled: false }) }));

import { transitionStaleStoriesToDormant } from './stories-repository';

beforeEach(() => db.exec('DELETE FROM stories'));

describe('transitionStaleStoriesToDormant', () => {
  it('marks developing stories with no update in >N days as dormant', () => {
    const old = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const fresh = new Date().toISOString();
    db.prepare("INSERT INTO stories (id,title,status,first_seen,last_updated) VALUES ('old','o','developing',?,?)").run(old, old);
    db.prepare("INSERT INTO stories (id,title,status,first_seen,last_updated) VALUES ('new','n','developing',?,?)").run(fresh, fresh);
    const n = transitionStaleStoriesToDormant(3);
    expect(n).toBe(1);
    expect((db.prepare("SELECT status FROM stories WHERE id='old'").get() as { status: string }).status).toBe('dormant');
    expect((db.prepare("SELECT status FROM stories WHERE id='new'").get() as { status: string }).status).toBe('developing');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/server/stories-repository.status.test.ts`
Expected: FAIL (`transitionStaleStoriesToDormant` not exported).

- [ ] **Step 3: Implement the transition**

Add to `lib/server/stories-repository.ts`:

```ts
export function transitionStaleStoriesToDormant(dormantAfterDays = 3): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - dormantAfterDays * 86_400_000).toISOString();
  const res = db.prepare(`
    UPDATE stories SET status = 'dormant'
    WHERE status = 'developing' AND last_updated < ?
  `).run(cutoff) as { changes: number };
  return res.changes;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/server/stories-repository.status.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Wire both jobs onto the worker tick**

In `lib/server/background-worker.ts`, find the block added in Phase 1 that calls `regenerateDirtyEntitySummaries` (inside `runFeedRefreshIfDue`, after `refreshTodaySummary`). Immediately after that block, add:

```ts
    // Story maintenance: debounced summaries + dormant transitions (cheap when idle).
    try {
      const stories = await import('./stories-repository');
      const summarized = await stories.regenerateDirtyStorySummaries();
      const dormant = stories.transitionStaleStoriesToDormant();
      if (summarized > 0 || dormant > 0) {
        console.log(`[IntelliDeck worker] Stories: ${summarized} summarized, ${dormant} -> dormant.`);
      }
    } catch (error) {
      console.error('[IntelliDeck worker] story maintenance failed:', error);
    }
```

- [ ] **Step 6: Commit**

```bash
git add lib/server/stories-repository.ts lib/server/stories-repository.status.test.ts lib/server/background-worker.ts
git commit -m "feat: developing->dormant transitions + worker wiring for story jobs"
```

---

## Task 9: "Since you last read" — story reads + detail query

**Files:**
- Modify: `lib/server/stories-repository.ts` (add `markStoryViewed`, `getStoryDetail`, `getRankedStories`)
- Test: `lib/server/stories-repository.detail.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/server/stories-repository.detail.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE stories (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'developing',
    summary TEXT, centroid TEXT, article_count INTEGER NOT NULL DEFAULT 0, salience REAL NOT NULL DEFAULT 0,
    summary_dirty_count INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_updated TEXT NOT NULL);
  CREATE TABLE story_events (id TEXT PRIMARY KEY, story_id TEXT NOT NULL, occurred_at TEXT NOT NULL, summary TEXT NOT NULL, article_id TEXT);
  CREATE TABLE story_reads (story_id TEXT PRIMARY KEY, last_viewed_at TEXT NOT NULL);
`);
vi.mock('./db', () => ({ getDb: () => db }));
vi.mock('@/lib/ai/providers', () => ({ generateText: vi.fn() }));
vi.mock('./settings-repository', () => ({ getServerAISettings: () => ({ enabled: false }) }));

import { markStoryViewed, getStoryDetail, getRankedStories } from './stories-repository';

beforeEach(() => { db.exec('DELETE FROM stories; DELETE FROM story_events; DELETE FROM story_reads;'); });

function seed() {
  db.prepare("INSERT INTO stories (id,title,status,summary,article_count,salience,first_seen,last_updated) VALUES ('s1','Quake','developing','sum',2,5,'2026-06-10T00:00:00.000Z','2026-06-14T00:00:00.000Z')").run();
  db.prepare("INSERT INTO story_events (id,story_id,occurred_at,summary) VALUES ('e1','s1','2026-06-10T00:00:00.000Z','first')").run();
  db.prepare("INSERT INTO story_events (id,story_id,occurred_at,summary) VALUES ('e2','s1','2026-06-13T00:00:00.000Z','update')").run();
}

describe('story detail + reads', () => {
  it('flags events newer than last view as new; none new before first view', () => {
    seed();
    const before = getStoryDetail('s1')!;
    expect(before.events).toHaveLength(2);
    expect(before.newEventCount).toBe(2); // never viewed -> all new
    markStoryViewed('s1', '2026-06-12T00:00:00.000Z');
    const after = getStoryDetail('s1')!;
    expect(after.newEventCount).toBe(1); // only e2 (2026-06-13) is newer
    expect(after.events.find((e) => e.id === 'e2')!.isNew).toBe(true);
    expect(after.events.find((e) => e.id === 'e1')!.isNew).toBe(false);
  });

  it('getRankedStories orders by salience and excludes closed', () => {
    seed();
    db.prepare("INSERT INTO stories (id,title,status,article_count,salience,first_seen,last_updated) VALUES ('s2','Closed','closed',1,9,'t','t')").run();
    db.prepare("INSERT INTO stories (id,title,status,article_count,salience,first_seen,last_updated) VALUES ('s3','Low','developing',1,1,'t','t')").run();
    const ranked = getRankedStories(10);
    expect(ranked.map((s) => s.id)).toEqual(['s1', 's3']);
  });

  it('getStoryDetail returns null for unknown id', () => {
    expect(getStoryDetail('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/server/stories-repository.detail.test.ts`
Expected: FAIL (functions not exported).

- [ ] **Step 3: Implement**

Add to `lib/server/stories-repository.ts`:

```ts
export interface StoryEvent {
  id: string;
  occurredAt: string;
  summary: string;
  articleId: string | null;
  isNew: boolean;
}

export interface StoryDetail {
  story: StoryRow;
  events: StoryEvent[];
  lastViewedAt: string | null;
  newEventCount: number;
}

export interface RankedStory {
  id: string;
  title: string;
  status: string;
  summary: string | null;
  articleCount: number;
  salience: number;
  lastUpdated: string;
  newEventCount: number;
}

export function markStoryViewed(storyId: string, viewedAt = new Date().toISOString()): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO story_reads (story_id, last_viewed_at) VALUES (?, ?)
    ON CONFLICT(story_id) DO UPDATE SET last_viewed_at = excluded.last_viewed_at
  `).run(storyId, viewedAt);
}

function getLastViewedAt(storyId: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT last_viewed_at AS v FROM story_reads WHERE story_id = ?').get(storyId) as { v: string } | undefined;
  return row?.v ?? null;
}

export function getStoryDetail(id: string): StoryDetail | null {
  const story = getStoryById(id);
  if (!story) return null;
  const db = getDb();
  const lastViewedAt = getLastViewedAt(id);
  const rows = db.prepare(`
    SELECT id, occurred_at AS occurredAt, summary, article_id AS articleId
    FROM story_events WHERE story_id = ? ORDER BY occurred_at DESC
  `).all(id) as Array<{ id: string; occurredAt: string; summary: string; articleId: string | null }>;
  const events: StoryEvent[] = rows.map((r) => ({
    ...r,
    isNew: lastViewedAt === null ? true : Date.parse(r.occurredAt) > Date.parse(lastViewedAt),
  }));
  return { story, events, lastViewedAt, newEventCount: events.filter((e) => e.isNew).length };
}

export function getRankedStories(limit: number): RankedStory[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT s.id, s.title, s.status, s.summary, s.article_count AS articleCount,
           s.salience, s.last_updated AS lastUpdated,
           (SELECT COUNT(*) FROM story_events e
              WHERE e.story_id = s.id
                AND (r.last_viewed_at IS NULL OR e.occurred_at > r.last_viewed_at)) AS newEventCount
    FROM stories s
    LEFT JOIN story_reads r ON r.story_id = s.id
    WHERE s.status != 'closed'
    ORDER BY s.salience DESC, s.last_updated DESC
    LIMIT ?
  `).all(limit) as RankedStory[];
  return rows;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/server/stories-repository.detail.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite (Stage A+B gate)**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/server/stories-repository.ts lib/server/stories-repository.detail.test.ts
git commit -m "feat: story detail with since-you-last-read diff + ranked stories"
```

> **CHECKPOINT:** Backend complete. Review before Stage C (UI). Optionally smoke-test live: with the dev server running and AI enabled, reprocess articles (`POST /api/intelligence/reprocess`) and confirm `SELECT COUNT(*) FROM stories` and `story_events` grow, and multi-article stories appear (`SELECT title, article_count FROM stories ORDER BY article_count DESC`).

---

## Task 10: Story APIs (list, detail, mark-viewed)

**Files:**
- Create: `app/api/stories/route.ts`
- Create: `app/api/stories/[id]/route.ts`
- Create: `app/api/stories/[id]/view/route.ts`

- [ ] **Step 1: List route**

Create `app/api/stories/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getRankedStories } from '@/lib/server/stories-repository';

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get('limit') ?? '50');
  const stories = getRankedStories(Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 50);
  return NextResponse.json({ stories });
}
```

- [ ] **Step 2: Detail route**

Create `app/api/stories/[id]/route.ts` (match the App Router `params: Promise<...>` signature used by `app/api/intelligence/entity/[id]/route.ts`):

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getStoryDetail } from '@/lib/server/stories-repository';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const detail = getStoryDetail(id);
  if (!detail) return NextResponse.json({ error: 'Story not found' }, { status: 404 });
  return NextResponse.json(detail);
}
```

- [ ] **Step 3: Mark-viewed route**

Create `app/api/stories/[id]/view/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { markStoryViewed } from '@/lib/server/stories-repository';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  markStoryViewed(id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Verify routes respond**

Start the dev server (preview workflow / `npm run dev`) and check:
```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3001/api/stories?limit=5"   # 200
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3001/api/stories/nope"        # 404
```
Expected: `200` then `404`.

- [ ] **Step 5: Commit**

```bash
git add app/api/stories
git commit -m "feat: story list/detail/mark-viewed APIs"
```

---

## Task 11: StoryCard component

**Files:**
- Create: `components/deck/StoryCard.tsx`
- Modify: `lib/i18n/en.json`, `lib/i18n/zh-CN.json`

> Uses the project's class conventions (`text-foreground`, `opacity-*`, `border-border`, `text-accent`, `bg-card`, `rounded-lg`), the `@/lib/i18n` `useTranslation` hook, and `RelativeTime` (`date` prop) — same as the Phase 1 entity page.

- [ ] **Step 1: Add i18n strings**

In `lib/i18n/en.json`, add a top-level `story` block (after the `entity` block from Phase 1):

```json
"story": {
  "developing": "Developing",
  "dormant": "Dormant",
  "updated": "updated",
  "sources": "sources",
  "newSinceLastRead": "{{count}} new since you last read",
  "timeline": "Timeline",
  "openAgent": "Research with Agent",
  "noStories": "No stories yet — they form as related articles are ingested."
}
```

In `lib/i18n/zh-CN.json`, add the matching block:

```json
"story": {
  "developing": "进行中",
  "dormant": "已沉寂",
  "updated": "更新于",
  "sources": "来源",
  "newSinceLastRead": "上次阅读后有 {{count}} 条新进展",
  "timeline": "时间线",
  "openAgent": "用智能体研究",
  "noStories": "暂无故事——当相关文章被采集后会自动形成。"
}
```

> Verify the `t()` helper's interpolation syntax by checking an existing string with a variable in `lib/i18n/index.ts`. If it does NOT support `{{count}}`, render the count in the component with string concatenation instead (e.g. `` `${count} new since you last read` ``) and drop the placeholder from the JSON.

- [ ] **Step 2: Create the component**

Create `components/deck/StoryCard.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { RelativeTime } from '@/components/ui/RelativeTime';

export interface StoryCardEvent {
  id: string;
  occurredAt: string;
  summary: string;
  articleId: string | null;
  isNew: boolean;
}

export interface StoryCardData {
  id: string;
  title: string;
  status: string;
  summary: string | null;
  articleCount: number;
  lastUpdated: string;
  newEventCount: number;
}

interface StoryCardProps {
  story: StoryCardData;
  events?: StoryCardEvent[];        // provided when expanded detail is loaded
  expanded?: boolean;
  onToggle?: (id: string) => void;
  onResearch?: (id: string) => void;
}

export function StoryCard({ story, events, expanded = false, onToggle, onResearch }: StoryCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(expanded);
  const isOpen = onToggle ? expanded : open;

  const toggle = () => {
    if (onToggle) onToggle(story.id);
    else setOpen((v) => !v);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3 text-foreground">
      <button type="button" onClick={toggle} className="w-full text-left">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide opacity-60">
          <span className={story.status === 'developing' ? 'text-accent' : ''}>
            {story.status === 'developing' ? t('story.developing') : t('story.dormant')}
          </span>
          <span>· {story.articleCount} {t('story.sources')}</span>
          <span>· {t('story.updated')} <RelativeTime date={story.lastUpdated} /></span>
        </div>
        <h3 className="mt-1 font-semibold leading-snug">{story.title}</h3>
        {story.summary && <p className="mt-1 text-sm opacity-70 line-clamp-3">{story.summary}</p>}
        {story.newEventCount > 0 && (
          <p className="mt-1 text-xs text-accent">
            {`${story.newEventCount} ${t('story.newSinceLastRead').replace('{{count}}', String(story.newEventCount)).replace(/^\d+\s*/, '')}`.trim()}
          </p>
        )}
      </button>

      {isOpen && events && (
        <div className="mt-3 border-t border-border pt-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide opacity-60">{t('story.timeline')}</div>
          <ol className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className={`text-sm ${e.isNew ? 'opacity-100' : 'opacity-70'}`}>
                <span className="opacity-50 mr-2"><RelativeTime date={e.occurredAt} /></span>
                {e.isNew && <span className="mr-1 text-accent">●</span>}
                {e.summary}
              </li>
            ))}
          </ol>
          {onResearch && (
            <button
              type="button"
              onClick={() => onResearch(story.id)}
              className="mt-3 text-sm text-accent hover:underline"
            >
              {t('story.openAgent')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

> The `newSinceLastRead` rendering above is defensive against whether the i18n helper interpolates. If your `t()` supports options (e.g. `t('story.newSinceLastRead', { count })`), simplify to that and remove the `.replace(...)` chain.

- [ ] **Step 3: Commit**

```bash
git add components/deck/StoryCard.tsx lib/i18n/en.json lib/i18n/zh-CN.json
git commit -m "feat: StoryCard component (collapsed + timeline, since-last-read markers)"
```

---

## Task 12: StoriesFeed component (ranked list + detail)

**Files:**
- Create: `components/StoriesFeed.tsx`

> Fetches `/api/stories`, renders `StoryCard`s; selecting one loads `/api/stories/[id]`, marks it viewed (`POST .../view`), and renders the expanded timeline. Calls `onResearch(storyId)` up to the parent (Today) to open the Agent drawer.

- [ ] **Step 1: Create the component**

Create `components/StoriesFeed.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { StoryCard, type StoryCardData, type StoryCardEvent } from '@/components/deck/StoryCard';

interface StoriesFeedProps {
  onResearch?: (storyId: string) => void;
}

export function StoriesFeed({ onResearch }: StoriesFeedProps) {
  const { t } = useTranslation();
  const [stories, setStories] = useState<StoryCardData[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<StoryCardEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/stories?limit=50', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setStories(d.stories ?? []))
      .catch(() => setStories([]))
      .finally(() => setLoaded(true));
  }, []);

  const select = useCallback((id: string) => {
    if (selectedId === id) { setSelectedId(null); return; }
    setSelectedId(id);
    setEvents([]);
    fetch(`/api/stories/${id}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setEvents(d.events ?? []);
        // Optimistically clear the "new" badge for this story in the list.
        setStories((prev) => prev.map((s) => (s.id === id ? { ...s, newEventCount: 0 } : s)));
      })
      .catch(() => setEvents([]));
    void fetch(`/api/stories/${id}/view`, { method: 'POST' }).catch(() => {});
  }, [selectedId]);

  if (loaded && stories.length === 0) {
    return <div className="p-6 text-sm text-foreground opacity-60">{t('story.noStories')}</div>;
  }

  return (
    <div className="space-y-2 p-3 overflow-y-auto h-full">
      {stories.map((story) => (
        <StoryCard
          key={story.id}
          story={story}
          events={selectedId === story.id ? events : undefined}
          expanded={selectedId === story.id}
          onToggle={select}
          onResearch={onResearch}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/StoriesFeed.tsx
git commit -m "feat: StoriesFeed (ranked list + on-select timeline + mark viewed)"
```

---

## Task 13: AgentDrawer — demote the Agent panel to a slide-in

**Files:**
- Create: `components/ui/AgentDrawer.tsx`

> Wraps the existing [components/TodayAgentPanel.tsx](../../../components/TodayAgentPanel.tsx) in a right-side slide-in. The panel and its store ([lib/today-agent-store.ts](../../../lib/today-agent-store.ts)) are unchanged — only how it is mounted. Open the [components/TodayAgentPanel.tsx](../../../components/TodayAgentPanel.tsx) props before writing this to pass through exactly what it requires (e.g. `aiSettings`, `locale`, `priorityItems`); match them.

- [ ] **Step 1: Inspect the panel's props**

Run: `grep -n "TodayAgentPanelProps\|export function TodayAgentPanel" components/TodayAgentPanel.tsx`
Note the required props; pass them through `AgentDrawer` unchanged.

- [ ] **Step 2: Create the drawer**

Create `components/ui/AgentDrawer.tsx` (replace the `TodayAgentPanel` props with the actual ones found in Step 1):

```tsx
'use client';

import { TodayAgentPanel } from '@/components/TodayAgentPanel';
import type { ComponentProps } from 'react';

type AgentPanelProps = ComponentProps<typeof TodayAgentPanel>;

interface AgentDrawerProps extends AgentPanelProps {
  open: boolean;
  onClose: () => void;
}

export function AgentDrawer({ open, onClose, ...panelProps }: AgentDrawerProps) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        className={`fixed right-0 top-0 z-50 h-full w-[420px] max-w-[90vw] border-l border-border bg-card
          shadow-xl transition-transform duration-200 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-border p-3">
          <span className="text-sm font-medium text-foreground">Agent</span>
          <button type="button" onClick={onClose} className="text-foreground opacity-60 hover:opacity-100">✕</button>
        </div>
        <div className="h-[calc(100%-49px)] overflow-hidden">
          <TodayAgentPanel {...(panelProps as AgentPanelProps)} />
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/ui/AgentDrawer.tsx
git commit -m "feat: AgentDrawer slide-in wrapping the existing Agent panel"
```

---

## Task 14: Today → Stories takeover

**Files:**
- Modify: `components/TodayWorkspace.tsx`

> Replace the always-on Agent column with `StoriesFeed`; mount `AgentDrawer` (closed by default), opened via `StoriesFeed`'s `onResearch`. Preserve the existing priority article feed + `ArticlePreviewPanel` regions. **Read the full current file first** — it was recently modified (the in-flight Today work merged in `4fc3aef`); integrate without dropping that.

- [ ] **Step 1: Read the current layout**

Run: `sed -n '1,60p' components/TodayWorkspace.tsx` and locate where `TodayAgentPanel` is rendered and what props it receives (those become `AgentDrawer` props).

- [ ] **Step 2: Swap the Agent column for StoriesFeed + AgentDrawer**

In `components/TodayWorkspace.tsx`:

1. Replace the import:
```tsx
import { TodayAgentPanel } from '@/components/TodayAgentPanel';
```
with:
```tsx
import { StoriesFeed } from '@/components/StoriesFeed';
import { AgentDrawer } from '@/components/ui/AgentDrawer';
```

2. Add drawer state inside the component (near the other `useState` hooks):
```tsx
  const [agentOpen, setAgentOpen] = useState(false);
```

3. Replace the JSX region that rendered `<TodayAgentPanel ... />` with `StoriesFeed`, and mount the drawer once near the root of the returned tree:
```tsx
        <StoriesFeed onResearch={() => setAgentOpen(true)} />
```
```tsx
      <AgentDrawer
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
        {/* pass the SAME props the old <TodayAgentPanel .../> received, e.g.: */}
        aiSettings={aiSettings}
        locale={locale}
        priorityItems={priorityItems}
      />
```

> Use the exact prop expressions the old `TodayAgentPanel` call site used (found in Step 1). If the old call passed `priorityItems={priorityItems}` etc., reuse those identifiers verbatim.

- [ ] **Step 3: Verify in the browser (preview workflow)**

Start the dev server. On `/`:
- Confirm the Stories column renders (or the empty-state message if no stories yet).
- Click "Research with Agent" on a story → the Agent drawer slides in; close it.
- Confirm the priority article feed + preview still work.
Take a screenshot for the user. Check `preview_console_logs` for errors.

- [ ] **Step 4: Commit**

```bash
git add components/TodayWorkspace.tsx
git commit -m "feat: Today shows Stories feed; Agent becomes a slide-in drawer"
```

---

## Task 15: Raw-feed Stories⇄Raw toggle

**Files:**
- Modify: the raw-feed deck page/container (find with: `grep -rn "raw-feed\|DeckContainer" app/raw-feed components/deck/DeckContainer.tsx`)

> Add a small toggle at the top of the deck. "Raw" = existing column deck (unchanged). "Stories" = render `StoriesFeed` in a single full-width column. Default to "Raw" so existing behavior is untouched unless the user opts in.

- [ ] **Step 1: Locate the deck render root**

Run: `sed -n '1,50p' components/deck/DeckContainer.tsx` and find the page that renders it under `app/raw-feed/`.

- [ ] **Step 2: Add the toggle**

In the raw-feed page component (the client component that renders the deck), add:

```tsx
  const [mode, setMode] = useState<'raw' | 'stories'>('raw');
```

Render a toggle above the deck:

```tsx
  <div className="flex gap-1 p-2">
    <button
      type="button"
      onClick={() => setMode('raw')}
      className={`rounded px-3 py-1 text-sm ${mode === 'raw' ? 'bg-card text-accent' : 'text-foreground opacity-60'}`}
    >
      {t('nav.rawFeed')}
    </button>
    <button
      type="button"
      onClick={() => setMode('stories')}
      className={`rounded px-3 py-1 text-sm ${mode === 'stories' ? 'bg-card text-accent' : 'text-foreground opacity-60'}`}
    >
      {t('story.timeline')}
    </button>
  </div>
```

And switch the body:

```tsx
  {mode === 'stories'
    ? <div className="mx-auto max-w-2xl h-full"><StoriesFeed /></div>
    : <DeckContainer /* existing props */ />}
```

> Use the existing `DeckContainer` invocation with its current props for the `raw` branch — do not change them. Import `StoriesFeed` and `useTranslation` if not already present.

- [ ] **Step 3: Verify (preview workflow)**

Start the dev server, go to `/raw-feed`, confirm the toggle switches between the column deck and the Stories list with no console errors. Screenshot for the user.

- [ ] **Step 4: Commit**

```bash
git add app/raw-feed components/deck/DeckContainer.tsx
git commit -m "feat: raw-feed Stories<->Raw toggle"
```

---

## Task 16: Full suite + integration sanity

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass (Phase 1 + new vector-math/stories/assignment/adjudicator/summary/status/detail suites).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: compiles; the only acceptable failures are pre-existing `TodayAgentPanel` type errors unrelated to this plan (resolve if still present and trivial).

- [ ] **Step 3: End-to-end smoke (preview workflow, AI enabled)**

1. Start dev server; ensure Ollama reachable with `gemma4:12b-mlx` + `nomic-embed-text`.
2. `POST /api/intelligence/reprocess` with `{"limit":30}`; wait for the enrichment queue.
3. Confirm stories formed: `SELECT title, status, article_count FROM stories ORDER BY article_count DESC LIMIT 10` shows at least one multi-article story.
4. On `/`, confirm the Stories feed lists them, a story expands into a timeline, and "since you last read" markers behave (open a story, ingest more, reopen).
5. Confirm the Agent drawer opens from a story.

- [ ] **Step 4: Final commit (if verification fixes were made)**

```bash
git add -A
git commit -m "test: phase-2 stories integration sanity"
```

---

## Self-Review notes (for the implementer)

- **i18n interpolation:** Task 11 hedges on whether `t()` supports `{{count}}`. Confirm against `lib/i18n/index.ts` and pick the clean form; don't ship the defensive `.replace` chain if proper interpolation exists.
- **`TodayWorkspace`/`raw-feed` props:** Tasks 14–15 require reading the current files first — they reference existing identifiers (`aiSettings`, `locale`, `priorityItems`, `DeckContainer` props) that must be reused verbatim. Do not invent prop names.
- **Adjudication latency:** every above-threshold article triggers one `gemma4:12b-mlx` call (~tens of seconds on the M4). Enrichment is queued/serial so this is fine for throughput but means stories form with a lag. If too slow, lower `CANDIDATE_LIMIT` impact is nil (it's vector math); the cost is the LLM call — consider a faster adjudication model later (open decision, same as extraction).
- **Centroid storage:** centroids are JSON in `stories.centroid` (not a `vec0` table) — fine at single-user scale (hundreds of stories, in-memory cosine). If story count grows large, migrate candidate matching to a `story_vectors` vec0 table.
- **Credibility:** the source doc's `stories.credibility` is intentionally omitted (no Credibility Signals source wired yet); add when that exists.
- **Coexistence with entities:** stories and entities are independent graphs over the same articles; no shared writes, so no conflict with Phase 1's entity enrichment.
