# Digestion Core Phase 2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the topics surface live and bounded-LLM: continuous deterministic digestion in the background worker, a threshold-triggered + rate-capped LLM summary consumer, and a single cached "what's going on" digest — all running alongside the current home (non-breaking).

**Architecture:** The deterministic pipeline (Phase 1) is wired into the worker so topics build continuously. A separate, rate-capped consumer summarizes only topics that crossed a volume/momentum threshold and are stale (cooldown/growth-gated), so the LLM can never back up. One scheduled call produces a cached top-of-page digest. The old story/entity LLM sweeps are untouched here (retired later in 2c, after the UI cutover in 2b).

**Tech Stack:** TypeScript, `node:sqlite`, Vitest. Reuses `runLLM` (`lib/server/llm.ts`), `getServerAISettings` (`lib/server/settings-repository.ts`), and Phase 1's `topics-repository` / `topic-digestion`.

---

## File Structure

- `lib/server/db.ts` *(modify)* — add a `topic_digest` single-row cache table inside `applyTopicsSchema`.
- `lib/server/topics-repository.ts` *(modify)* — `getSummaryEligibleTopicIds`, `getTopicArticleTitles`, `writeTopicSummary`, `getCachedDigest`, `setCachedDigest`.
- `lib/server/topic-summary.ts` *(create)* — `summarizeEligibleTopics` (the rate-capped LLM consumer) and `generateTopicDigest` (cached narrative). LLM call is injectable for tests.
- `lib/server/background-worker.ts` *(modify)* — wire a continuous topic-digestion pass, the summary consumer, and the digest schedule into `tick()`.
- `app/api/digest/route.ts` *(modify)* — include the cached digest narrative in the response.

**Phase 2a deferrals:** no home UI changes (2b), no retirement of old sweeps (2c). The summary model defaults to the configured chat model (`gemma3:12b`); a faster model is a later config lever.

---

## Task 1: Schema — `topic_digest` cache table

**Files:**
- Modify: `lib/server/db.ts` (inside `applyTopicsSchema`, after the `topic_articles` index)
- Test: `lib/server/topic-digest-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/server/topic-digest-schema.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
vi.mock('server-only', () => ({}));
import { applyTopicsSchema } from './db';

describe('topic_digest schema', () => {
  it('creates a single-row digest cache table', () => {
    const db = new DatabaseSync(':memory:');
    applyTopicsSchema(db);
    const cols = (db.prepare("SELECT name FROM pragma_table_info('topic_digest')").all() as Array<{ name: string }>).map((r) => r.name);
    expect(cols).toEqual(expect.arrayContaining(['id', 'narrative', 'generated_at']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/server/topic-digest-schema.test.ts`
Expected: FAIL — no such table `topic_digest`.

- [ ] **Step 3: Implement** — inside `applyTopicsSchema`, append to the `db.exec(`...`)` block (after the `idx_topics_status_lastseen` index line, before the closing backtick):

```sql
    CREATE TABLE IF NOT EXISTS topic_digest (
      id TEXT PRIMARY KEY,
      narrative TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/server/topic-digest-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/server/db.ts lib/server/topic-digest-schema.test.ts
git commit -m "feat(topics): topic_digest cache table"
```

---

## Task 2: Summary eligibility + cooldown query

**Files:**
- Modify: `lib/server/topics-repository.ts` (append)
- Test: `lib/server/topics-repository.summary.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/server/topics-repository.summary.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
vi.mock('server-only', () => ({}));
const db = new DatabaseSync(':memory:');
vi.mock('./db', async (orig) => ({ ...(await orig() as object), getDb: () => db }));
import { applyTopicsSchema } from './db';
applyTopicsSchema(db);
import { getSummaryEligibleTopicIds, SUMMARY_MIN_ARTICLES } from './topics-repository';

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
function topic(id: string, over: Partial<Record<string, unknown>>) {
  const base: Record<string, unknown> = {
    status: 'active', article_count: 6, momentum: 'escalating', score: 10,
    summary: null, summary_state: 'none', summary_at: null, summary_article_count: 0,
    last_seen_at: iso(1000), first_seen_at: iso(1000), created_at: iso(1000), updated_at: iso(1000),
    velocity: 1, source_count: 3, centroid: '[1]', top_line: 't',
  };
  const row = { ...base, ...over, id };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO topics (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c]));
}

beforeEach(() => { db.exec('DELETE FROM topics;'); });

describe('getSummaryEligibleTopicIds', () => {
  it('selects an escalating topic over the article floor that has no summary', () => {
    topic('hot', { momentum: 'escalating', article_count: 6, summary: null });
    expect(getSummaryEligibleTopicIds(10, now)).toContain('hot');
  });
  it('excludes topics below the article floor', () => {
    topic('thin', { article_count: SUMMARY_MIN_ARTICLES - 1 });
    expect(getSummaryEligibleTopicIds(10, now)).not.toContain('thin');
  });
  it('excludes steady/quiet topics even if large', () => {
    topic('big-steady', { momentum: 'steady', article_count: 50 });
    expect(getSummaryEligibleTopicIds(10, now)).not.toContain('big-steady');
  });
  it('excludes a fresh summary that has not grown and is within cooldown', () => {
    topic('fresh', { summary: 'done', summary_state: 'fresh', summary_at: iso(60_000), summary_article_count: 6, article_count: 6 });
    expect(getSummaryEligibleTopicIds(10, now)).not.toContain('fresh');
  });
  it('re-queues a summarized topic once it grows >= 50%', () => {
    topic('grown', { summary: 'old', summary_state: 'fresh', summary_at: iso(60_000), summary_article_count: 6, article_count: 9 });
    expect(getSummaryEligibleTopicIds(10, now)).toContain('grown');
  });
  it('re-queues a summarized topic past the cooldown', () => {
    topic('stale', { summary: 'old', summary_state: 'fresh', summary_at: iso(60 * 60_000), summary_article_count: 6, article_count: 6 });
    expect(getSummaryEligibleTopicIds(10, now)).toContain('stale');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/server/topics-repository.summary.test.ts`
Expected: FAIL — `getSummaryEligibleTopicIds` not exported.

- [ ] **Step 3: Implement** — append to `lib/server/topics-repository.ts`:

```ts
// --- Phase 2a: LLM summary eligibility ------------------------------------------------
export const SUMMARY_MIN_ARTICLES = 4;       // a topic must have real volume to earn a summary
export const SUMMARY_GROWTH_RATIO = 1.5;     // re-summarize once it grows >= 50% since last time
export const SUMMARY_COOLDOWN_MS = 30 * 60_000; // ...or after this long, whichever comes first

/** IDs of topics that have crossed the volume/momentum threshold AND whose summary is stale
 *  (missing, materially grown, or past cooldown), ordered by priority (breaking first, then
 *  score). The LLM consumer pulls from the head of this list, rate-capped. */
export function getSummaryEligibleTopicIds(limit: number, now = Date.now()): string[] {
  const cooldownBefore = new Date(now - SUMMARY_COOLDOWN_MS).toISOString();
  return (getDb().prepare(
    `SELECT id FROM topics
     WHERE status = 'active'
       AND article_count >= ?
       AND momentum IN ('escalating', 'breaking')
       AND (
         summary IS NULL
         OR article_count >= summary_article_count * ?
         OR summary_at IS NULL
         OR summary_at < ?
       )
     ORDER BY CASE momentum WHEN 'breaking' THEN 0 ELSE 1 END, score DESC
     LIMIT ?`,
  ).all(SUMMARY_MIN_ARTICLES, SUMMARY_GROWTH_RATIO, cooldownBefore, limit) as Array<{ id: string }>).map((r) => r.id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/server/topics-repository.summary.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/topics-repository.ts lib/server/topics-repository.summary.test.ts
git commit -m "feat(topics): threshold + cooldown summary eligibility query"
```

---

## Task 3: Summary writer, article-titles reader, digest cache accessors

**Files:**
- Modify: `lib/server/topics-repository.ts` (append)
- Test: `lib/server/topics-repository.summary-write.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/server/topics-repository.summary-write.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
vi.mock('server-only', () => ({}));
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE articles (id TEXT PRIMARY KEY, title TEXT, published_at TEXT, created_at TEXT);`);
vi.mock('./db', async (orig) => ({ ...(await orig() as object), getDb: () => db }));
import { applyTopicsSchema } from './db';
applyTopicsSchema(db);
import { writeTopicSummary, getTopicArticleTitles, getCachedDigest, setCachedDigest } from './topics-repository';

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
beforeEach(() => { db.exec('DELETE FROM topics; DELETE FROM topic_articles; DELETE FROM articles; DELETE FROM topic_digest;'); });

describe('summary write + digest cache', () => {
  it('writes a summary and marks it fresh with a snapshot of article_count', () => {
    db.prepare(`INSERT INTO topics (id,status,article_count,first_seen_at,last_seen_at,summary_state,summary_article_count,created_at,updated_at)
                VALUES ('t',' active',7,?,?,'none',0,?,?)`).run(iso(0), iso(0), iso(0), iso(0));
    db.prepare(`UPDATE topics SET status='active' WHERE id='t'`).run();
    writeTopicSummary('t', 'A concise summary.', now);
    const row = db.prepare(`SELECT summary, summary_state, summary_article_count FROM topics WHERE id='t'`).get() as { summary: string; summary_state: string; summary_article_count: number };
    expect(row.summary).toBe('A concise summary.');
    expect(row.summary_state).toBe('fresh');
    expect(row.summary_article_count).toBe(7);
  });

  it('reads topic article titles, oldest first', () => {
    db.prepare(`INSERT INTO topics (id,status,article_count,first_seen_at,last_seen_at,summary_state,summary_article_count,created_at,updated_at)
                VALUES ('t','active',2,?,?,'none',0,?,?)`).run(iso(0), iso(0), iso(0), iso(0));
    db.prepare('INSERT INTO articles (id,title,published_at) VALUES (?,?,?)').run('a1', 'First', iso(2000));
    db.prepare('INSERT INTO articles (id,title,published_at) VALUES (?,?,?)').run('a2', 'Second', iso(1000));
    db.prepare('INSERT INTO topic_articles (topic_id,article_id,added_at) VALUES (?,?,?)').run('t', 'a1', iso(2000));
    db.prepare('INSERT INTO topic_articles (topic_id,article_id,added_at) VALUES (?,?,?)').run('t', 'a2', iso(1000));
    expect(getTopicArticleTitles('t', 10)).toEqual(['First', 'Second']);
  });

  it('round-trips the cached digest', () => {
    expect(getCachedDigest()).toBeNull();
    setCachedDigest('Today the world is...', now);
    expect(getCachedDigest()?.narrative).toBe('Today the world is...');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/server/topics-repository.summary-write.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement** — append to `lib/server/topics-repository.ts`:

```ts
/** Persist an LLM summary and mark it fresh, snapshotting the current article_count so the
 *  growth-based re-summarize gate (Task 2) measures from here. */
export function writeTopicSummary(topicId: string, summary: string, now = Date.now()): void {
  const nowIso = new Date(now).toISOString();
  getDb().prepare(
    `UPDATE topics SET summary = ?, summary_state = 'fresh', summary_at = ?,
            summary_article_count = article_count, updated_at = ? WHERE id = ?`,
  ).run(summary, nowIso, nowIso, topicId);
}

/** Member article titles (oldest first) — the raw material for a topic summary prompt. */
export function getTopicArticleTitles(topicId: string, limit: number): string[] {
  return (getDb().prepare(
    `SELECT a.title FROM topic_articles ta JOIN articles a ON a.id = ta.article_id
     WHERE ta.topic_id = ? ORDER BY COALESCE(a.published_at, a.created_at) ASC LIMIT ?`,
  ).all(topicId, limit) as Array<{ title: string }>).map((r) => r.title);
}

export interface CachedDigest { narrative: string; generatedAt: string; }
export function getCachedDigest(): CachedDigest | null {
  const row = getDb().prepare(`SELECT narrative, generated_at AS generatedAt FROM topic_digest WHERE id = 'current'`).get() as CachedDigest | undefined;
  return row ?? null;
}
export function setCachedDigest(narrative: string, now = Date.now()): void {
  getDb().prepare(
    `INSERT INTO topic_digest (id, narrative, generated_at) VALUES ('current', ?, ?)
     ON CONFLICT(id) DO UPDATE SET narrative = excluded.narrative, generated_at = excluded.generated_at`,
  ).run(narrative, new Date(now).toISOString());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/server/topics-repository.summary-write.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/topics-repository.ts lib/server/topics-repository.summary-write.test.ts
git commit -m "feat(topics): summary writer + article-titles reader + digest cache"
```

---

## Task 4: The rate-capped LLM summary consumer

**Files:**
- Create: `lib/server/topic-summary.ts`
- Test: `lib/server/topic-summary.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/server/topic-summary.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
vi.mock('server-only', () => ({}));
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE articles (id TEXT PRIMARY KEY, title TEXT, published_at TEXT, created_at TEXT);`);
vi.mock('./db', async (orig) => ({ ...(await orig() as object), getDb: () => db }));
vi.mock('./settings-repository', () => ({ getServerAISettings: () => ({ enabled: true, provider: 'ollama', model: 'gemma3:12b', baseUrl: 'x' }) }));
import { applyTopicsSchema } from './db';
applyTopicsSchema(db);
import { summarizeEligibleTopics } from './topic-summary';

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
function escalatingTopic(id: string, count: number) {
  db.prepare(`INSERT INTO topics (id,status,article_count,momentum,score,summary_state,summary_article_count,first_seen_at,last_seen_at,created_at,updated_at)
              VALUES (?,'active',?, 'escalating',10,'none',0,?,?,?,?)`).run(id, count, iso(0), iso(0), iso(0), iso(0));
  for (let i = 0; i < count; i += 1) {
    db.prepare('INSERT INTO articles (id,title,published_at) VALUES (?,?,?)').run(`${id}-${i}`, `${id} headline ${i}`, iso(1000 * i));
    db.prepare('INSERT INTO topic_articles (topic_id,article_id,added_at) VALUES (?,?,?)').run(id, `${id}-${i}`, iso(1000 * i));
  }
}
beforeEach(() => { db.exec('DELETE FROM topics; DELETE FROM topic_articles; DELETE FROM articles;'); });

describe('summarizeEligibleTopics', () => {
  it('summarizes at most maxPerRun eligible topics and never exceeds the cap', async () => {
    for (const id of ['a', 'b', 'c', 'd']) escalatingTopic(id, 6);
    const calls: string[] = [];
    const runLLM = vi.fn(async (_s: unknown, prompt: string) => { calls.push(prompt); return 'SUMMARY TEXT'; });
    const n = await summarizeEligibleTopics({ maxPerRun: 2, now, runLLM });
    expect(n).toBe(2);
    expect(runLLM).toHaveBeenCalledTimes(2);
    const summarized = db.prepare(`SELECT COUNT(*) c FROM topics WHERE summary_state='fresh'`).get() as { c: number };
    expect(summarized.c).toBe(2);
  });

  it('writes the model output as the topic summary', async () => {
    escalatingTopic('solo', 5);
    const runLLM = vi.fn(async () => 'The situation is developing.');
    await summarizeEligibleTopics({ maxPerRun: 5, now, runLLM });
    const row = db.prepare(`SELECT summary FROM topics WHERE id='solo'`).get() as { summary: string };
    expect(row.summary).toBe('The situation is developing.');
  });

  it('does nothing when AI is disabled', async () => {
    escalatingTopic('x', 6);
    const runLLM = vi.fn(async () => 'nope');
    const n = await summarizeEligibleTopics({ maxPerRun: 5, now, runLLM, enabled: false });
    expect(n).toBe(0);
    expect(runLLM).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/server/topic-summary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `lib/server/topic-summary.ts`:

```ts
import 'server-only';
import { runLLM as realRunLLM } from './llm';
import { getServerAISettings } from './settings-repository';
import { getSummaryEligibleTopicIds, getTopicArticleTitles, writeTopicSummary } from './topics-repository';

type RunLLM = (settings: { provider: string; model: string; baseUrl?: string; apiKey?: string }, prompt: string, options?: object) => Promise<string>;

const MAX_TITLES = 12;

function buildSummaryPrompt(titles: string[]): string {
  return [
    'You are summarizing a developing news topic for an intelligence dashboard.',
    'Write 2-3 factual, concise sentences capturing what is happening. No preamble, no markdown headings.',
    '',
    'ARTICLES IN THIS TOPIC:',
    ...titles.map((t) => `- ${t}`),
    '',
    'SUMMARY:',
  ].join('\n');
}

/**
 * Rate-capped LLM summary consumer: summarize at most `maxPerRun` eligible topics (head of the
 * priority queue), so the model can never back up regardless of how many topics are hot. Each
 * summary is best-effort; one failure does not block the rest.
 */
export async function summarizeEligibleTopics(opts: {
  maxPerRun: number;
  now?: number;
  runLLM?: RunLLM;
  enabled?: boolean;
}): Promise<number> {
  const settings = getServerAISettings();
  const enabled = opts.enabled ?? settings.enabled;
  if (!enabled) return 0;
  const now = opts.now ?? Date.now();
  const runLLM = (opts.runLLM ?? realRunLLM) as RunLLM;

  const ids = getSummaryEligibleTopicIds(opts.maxPerRun, now);
  let done = 0;
  for (const id of ids) {
    try {
      const titles = getTopicArticleTitles(id, MAX_TITLES);
      if (titles.length === 0) continue;
      const text = (await runLLM(settings, buildSummaryPrompt(titles), { temperature: 0.2, maxTokens: 200 })).trim();
      if (text) { writeTopicSummary(id, text, now); done += 1; }
    } catch (error) {
      console.error(`[topic-summary] failed for ${id}:`, error);
    }
  }
  return done;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/server/topic-summary.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/topic-summary.ts lib/server/topic-summary.test.ts
git commit -m "feat(topics): rate-capped threshold-triggered LLM summary consumer"
```

---

## Task 5: Cached "what's going on" digest

**Files:**
- Modify: `lib/server/topic-summary.ts` (append `generateTopicDigest`)
- Test: `lib/server/topic-digest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/server/topic-digest.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
vi.mock('server-only', () => ({}));
const db = new DatabaseSync(':memory:');
vi.mock('./db', async (orig) => ({ ...(await orig() as object), getDb: () => db }));
vi.mock('./settings-repository', () => ({ getServerAISettings: () => ({ enabled: true, provider: 'ollama', model: 'gemma3:12b', baseUrl: 'x' }) }));
import { applyTopicsSchema } from './db';
applyTopicsSchema(db);
import { generateTopicDigest } from './topic-summary';
import { getCachedDigest } from './topics-repository';

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
beforeEach(() => { db.exec('DELETE FROM topics; DELETE FROM topic_digest;'); });

describe('generateTopicDigest', () => {
  it('synthesizes the top topics into one cached narrative', async () => {
    db.prepare(`INSERT INTO topics (id,status,top_line,momentum,score,article_count,first_seen_at,last_seen_at,summary_state,summary_article_count,created_at,updated_at)
                VALUES ('a','active','US-Iran talks','escalating',50,12,?,?,'none',0,?,?),('b','active','Markets fall','breaking',40,8,?,?,'none',0,?,?)`)
      .run(iso(0), iso(0), iso(0), iso(0), iso(0), iso(0), iso(0), iso(0));
    let captured = '';
    const runLLM = vi.fn(async (_s: unknown, prompt: string) => { captured = prompt; return 'World briefing text.'; });
    await generateTopicDigest({ now, runLLM });
    expect(captured).toContain('US-Iran talks');
    expect(captured).toContain('Markets fall');
    expect(getCachedDigest()?.narrative).toBe('World briefing text.');
  });

  it('does nothing when there are no active topics', async () => {
    const runLLM = vi.fn(async () => 'x');
    await generateTopicDigest({ now, runLLM });
    expect(runLLM).not.toHaveBeenCalled();
    expect(getCachedDigest()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/server/topic-digest.test.ts`
Expected: FAIL — `generateTopicDigest` not exported.

- [ ] **Step 3: Implement** — first EXTEND the existing top-of-file import from `./topics-repository` in `lib/server/topic-summary.ts` to also import `getRankedTopics`, `setCachedDigest`, and `windowStartIso` (so it reads `import { getSummaryEligibleTopicIds, getTopicArticleTitles, writeTopicSummary, getRankedTopics, setCachedDigest, windowStartIso } from './topics-repository';`). Then append the function below:

```ts
const DIGEST_TOP_N = 10;

/** One scheduled LLM call that synthesizes the top deterministic topics into a single cached
 *  "what's going on right now" narrative. Does NOT re-summarize each topic — it works from the
 *  already-computed top-lines + momentum. No-op when there are no active topics. */
export async function generateTopicDigest(opts: {
  now?: number;
  runLLM?: RunLLM;
  enabled?: boolean;
}): Promise<boolean> {
  const settings = getServerAISettings();
  const enabled = opts.enabled ?? settings.enabled;
  if (!enabled) return false;
  const now = opts.now ?? Date.now();
  const runLLM = (opts.runLLM ?? realRunLLM) as RunLLM;

  const topics = getRankedTopics(DIGEST_TOP_N, windowStartIso(now));
  if (topics.length === 0) return false;

  const lines = topics.map((t) => `- [${t.momentum.toUpperCase()}] ${t.topLine ?? ''} (${t.articleCount} articles)`);
  const prompt = [
    'Write a 3-4 sentence "what is going on right now" intelligence briefing from these top',
    'developing topics. Be factual and concise. No preamble, no markdown headings.',
    '',
    'TOP TOPICS:',
    ...lines,
    '',
    'BRIEFING:',
  ].join('\n');

  try {
    const text = (await runLLM(settings, prompt, { temperature: 0.3, maxTokens: 250 })).trim();
    if (text) { setCachedDigest(text, now); return true; }
  } catch (error) {
    console.error('[topic-digest] generation failed:', error);
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/server/topic-digest.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/topic-summary.ts lib/server/topic-digest.test.ts
git commit -m "feat(topics): cached what's-going-on digest narrative"
```

---

## Task 6: Wire into the background worker

**Files:**
- Modify: `lib/server/background-worker.ts`

No unit test (module-global worker state + dynamic imports); the underlying functions are all unit-tested. Verified by the manual smoke in Task 7.

- [ ] **Step 1: Add the three pass functions** — in `lib/server/background-worker.ts`, after `runDailySynthesisIfDue` (~line 211):

```ts
const TOPIC_DIGEST_INTERVAL_MS = 45 * 60_000; // regenerate the "what's going on" narrative this often
let lastTopicDigestAt = 0;
const TOPIC_SUMMARY_MAX_PER_RUN = 3; // rate cap: at most this many topic summaries per 60s tick

async function runTopicDigestionPass(): Promise<void> {
  await runMaintenancePass('topic digestion', async () => {
    const { digestRecentArticles } = await import('./topic-digestion');
    const { archiveStaleTopics, windowStartIso } = await import('./topics-repository');
    const ws = windowStartIso();
    const { digested } = digestRecentArticles(ws, 1000);
    const archived = archiveStaleTopics(ws);
    if (digested > 0 || archived > 0) {
      console.log(`[IntelliDeck worker] Topics: digested ${digested}, archived ${archived}.`);
    }
  });
}

async function runTopicSummaryPass(): Promise<void> {
  await runMaintenancePass('topic summary', async () => {
    const { summarizeEligibleTopics } = await import('./topic-summary');
    const n = await summarizeEligibleTopics({ maxPerRun: TOPIC_SUMMARY_MAX_PER_RUN });
    if (n > 0) console.log(`[IntelliDeck worker] Summarized ${n} topics.`);
  });
}

async function runTopicDigestIfDue(): Promise<void> {
  if (Date.now() - lastTopicDigestAt < TOPIC_DIGEST_INTERVAL_MS) return;
  lastTopicDigestAt = Date.now();
  await runMaintenancePass('topic digest narrative', async () => {
    const { generateTopicDigest } = await import('./topic-summary');
    const ok = await generateTopicDigest({});
    if (ok) console.log('[IntelliDeck worker] Regenerated topic digest narrative.');
  });
}
```

- [ ] **Step 2: Call them from `tick()`** — change the `tick` function (~line 230) to:

```ts
  const tick = () => {
    void runFeedRefreshIfDue(state);
    void runRollingMaintenanceIfIdle(state);
    void runIntervalBriefIfDue();
    void runDailySynthesisIfDue();
    // Phase 2a: deterministic topic digestion runs every tick; LLM summary consumer is
    // rate-capped; the digest narrative is on its own interval. None block the others.
    void runTopicDigestionPass();
    void runTopicSummaryPass();
    void runTopicDigestIfDue();
  };
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "background-worker|topic-summary|topic-digestion" || echo "no new errors in touched files"`
Expected: no new errors referencing these files (pre-existing unrelated errors may remain).

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: all green (no worker unit tests added; nothing broken).

- [ ] **Step 5: Commit**

```bash
git add lib/server/background-worker.ts
git commit -m "feat(topics): wire continuous digestion + summary consumer + digest into worker"
```

---

## Task 7: Expose the digest in `/api/digest` + manual smoke

**Files:**
- Modify: `app/api/digest/route.ts`

- [ ] **Step 1: Include the cached digest narrative** — update `app/api/digest/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getRankedTopics, getTrendingTags, getCachedDigest, windowStartIso } from '@/lib/server/topics-repository';

export const dynamic = 'force-dynamic';

export async function GET() {
  const windowStart = windowStartIso();
  const topics = getRankedTopics(50, windowStart);
  const trending = getTrendingTags(20, windowStart);
  const digest = getCachedDigest();
  const breaking = topics.filter((t) => t.momentum === 'breaking').length;
  const escalating = topics.filter((t) => t.momentum === 'escalating').length;
  return NextResponse.json({
    topics, trending, digest,
    meta: { total: topics.length, breaking, escalating, generatedAt: new Date().toISOString() },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "api/digest" || echo "no new errors"`
Expected: no new errors in the route.

- [ ] **Step 3: Manual smoke against the dev server**

Restart the dev server (so the worker picks up the new passes and the `topic_digest` table is created), then:

```bash
# topics build continuously now; force one pass + wait for the worker, or trigger directly:
curl -s -X POST http://localhost:3001/api/digest/rebuild >/dev/null   # builds topics from the window
curl -s http://localhost:3001/api/digest | python3 -c "import sys,json;d=json.load(sys.stdin);print('topics',d['meta']['total'],'breaking',d['meta']['breaking'],'escalating',d['meta']['escalating']);print('digest:', (d.get('digest') or {}).get('narrative','(none yet — generated on worker schedule)')[:160]);print('summarized topics:', sum(1 for t in d['topics'] if t.get('summary')))"
```

Expected: topics present; over a few worker ticks the escalating topics gain `summary` values (rate-capped, a few per minute), and within ~45 min the `digest.narrative` populates. Confirm the LLM never floods — at most `TOPIC_SUMMARY_MAX_PER_RUN` summaries per tick.

- [ ] **Step 4: Commit**

```bash
git add app/api/digest/route.ts
git commit -m "feat(topics): expose cached digest narrative in /api/digest"
```

---

## Self-Review notes

- **Spec coverage:** threshold-triggered eligibility (Task 2), cooldown/growth gate (Task 2), summary writer + snapshot for cooldown (Task 3), rate-capped consumer (Task 4), cached "what's going on" digest from top-lines not per-topic re-summarization (Task 5), continuous deterministic digestion wired live (Task 6), digest exposed (Task 7). Decoupled: deterministic digestion (Task 6 `runTopicDigestionPass`) never awaits the LLM; the summary consumer is a separate rate-capped pass. Deferred per scope: home UI cutover (2b), retiring old sweeps (2c).
- **Type consistency:** `getSummaryEligibleTopicIds(limit, now)`, `getTopicArticleTitles(topicId, limit)`, `writeTopicSummary(topicId, summary, now)`, `getCachedDigest()`/`setCachedDigest(narrative, now)`, `CachedDigest`, `summarizeEligibleTopics({maxPerRun, now?, runLLM?, enabled?})`, `generateTopicDigest({now?, runLLM?, enabled?})`, and the `RunLLM` type are used consistently across tasks.
- **No placeholders:** every code step is complete.

## Validation gate before 2b/2c

After Task 7, confirm on real data over ~30-60 min that: topics stay current (continuous digestion keeps up), only escalating/breaking topics get summaries and never more than the rate cap per tick (watch the worker log), and the digest narrative reads coherently. Only then plan 2b (home UI cutover to `/api/digest`) and 2c (retire the old story/entity LLM sweeps).
