# Digestion Core Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, rolling-window "active topics" digestion model with a read API (`/api/digest`), running alongside the current home page — no LLM in the path.

**Architecture:** New `topics` / `topic_articles` tables hold only clusters active within a rolling window. A deterministic pipeline assigns each embedded article to a topic (cosine + IDF entity-overlap + entity-anchored candidates, ported from the working story clustering), recomputes that topic's denormalized signals (velocity, momentum, score, top-line), and a sweep archives quiet topics. `/api/digest` serves ranked active topics + trending tags from materialized fields.

**Tech Stack:** TypeScript, Next.js App Router, `node:sqlite` (`DatabaseSync`), `sqlite-vec`, Vitest. Reuses `vector-math` (`cosineSimilarity`, `runningMean`), `entity-extraction`, `entities-repository`, `article_vectors`.

**Phase 1 simplifications (deferred to Phase 2):** no LLM summaries (deterministic top-line only); no cross-window reactivation (a subject recurring after fully aging out forms a new topic); digestion is triggered via a manual `/api/digest/rebuild` endpoint, not yet wired into the live worker.

---

## File Structure

- `lib/server/db.ts` *(modify)* — create `topics` + `topic_articles` tables in `initializeDatabase`.
- `lib/server/topic-signals.ts` *(create)* — pure functions: `velocityPerHour`, `classifyMomentum`, `worthReadingScore`.
- `lib/server/topic-corroboration.ts` *(create)* — `topicEntityOverlapScore`, `articleCorroboratesTopic` (IDF overlap against `topic_articles`).
- `lib/server/topics-repository.ts` *(create)* — topic CRUD, centroid maintenance, candidate retrieval, signal recompute, archival, ranked read model, trending tags.
- `lib/server/topic-assignment.ts` *(create)* — `assignArticleToTopic`.
- `lib/server/topic-digestion.ts` *(create)* — `digestRecentArticles` (batch-digest window articles into topics).
- `app/api/digest/route.ts` *(create)* — GET ranked topics + trending tags.
- `app/api/digest/rebuild/route.ts` *(create)* — POST: digest window articles + archive stale.
- Tests: one `*.test.ts` beside each new `lib/server` module.

---

## Task 1: Schema — `topics` and `topic_articles`

**Files:**
- Modify: `lib/server/db.ts` (inside `initializeDatabase`, near the other `CREATE TABLE` statements ~line 266)
- Test: `lib/server/topics-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/server/topics-schema.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
vi.mock('server-only', () => ({}));
import { applyTopicsSchema } from './db';

describe('topics schema', () => {
  it('creates topics and topic_articles with expected columns', () => {
    const db = new DatabaseSync(':memory:');
    applyTopicsSchema(db);
    const cols = (db.prepare("SELECT name FROM pragma_table_info('topics')").all() as Array<{ name: string }>).map((r) => r.name);
    for (const c of ['id', 'status', 'centroid', 'top_line', 'article_count', 'source_count', 'first_seen_at', 'last_seen_at', 'velocity', 'momentum', 'score', 'summary', 'summary_state', 'summary_at', 'summary_article_count']) {
      expect(cols).toContain(c);
    }
    const taCols = (db.prepare("SELECT name FROM pragma_table_info('topic_articles')").all() as Array<{ name: string }>).map((r) => r.name);
    expect(taCols).toEqual(expect.arrayContaining(['topic_id', 'article_id', 'added_at']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/server/topics-schema.test.ts`
Expected: FAIL — `applyTopicsSchema is not a function` / not exported.

- [ ] **Step 3: Implement the schema function and call it**

In `lib/server/db.ts`, add an exported helper and call it from `initializeDatabase`:

```ts
// lib/server/db.ts — add near other CREATE TABLE blocks
export function applyTopicsSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'active',
      centroid TEXT,
      representative_article_id TEXT,
      top_line TEXT,
      article_count INTEGER NOT NULL DEFAULT 0,
      source_count INTEGER NOT NULL DEFAULT 0,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      velocity REAL NOT NULL DEFAULT 0,
      momentum TEXT NOT NULL DEFAULT 'quiet',
      score REAL NOT NULL DEFAULT 0,
      summary TEXT,
      summary_state TEXT NOT NULL DEFAULT 'none',
      summary_at TEXT,
      summary_article_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS topic_articles (
      topic_id TEXT NOT NULL,
      article_id TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (topic_id, article_id)
    );
    CREATE INDEX IF NOT EXISTS idx_topic_articles_article ON topic_articles(article_id);
    CREATE INDEX IF NOT EXISTS idx_topics_status_lastseen ON topics(status, last_seen_at);
  `);
}
```

Then inside `initializeDatabase(db)`, add a call: `applyTopicsSchema(db);`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/server/topics-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/server/db.ts lib/server/topics-schema.test.ts
git commit -m "feat(topics): add topics + topic_articles schema"
```

---

## Task 2: Deterministic signals — `topic-signals.ts`

**Files:**
- Create: `lib/server/topic-signals.ts`
- Test: `lib/server/topic-signals.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/server/topic-signals.test.ts
import { describe, it, expect } from 'vitest';
import { velocityPerHour, classifyMomentum, worthReadingScore } from './topic-signals';

const H = 3_600_000;
const now = Date.UTC(2026, 5, 24, 12, 0, 0);
const agoH = (h: number) => now - h * H;

describe('velocityPerHour', () => {
  it('counts articles in the window divided by hours', () => {
    const ts = [agoH(0.5), agoH(1), agoH(2), agoH(50)]; // 3 within last 3h
    expect(velocityPerHour(ts, now, 3)).toBeCloseTo(1, 5);
  });
});

describe('classifyMomentum', () => {
  it('is quiet with no recent articles', () => {
    expect(classifyMomentum([agoH(50)], now, 72)).toBe('quiet');
  });
  it('is breaking on a high-volume recent spike', () => {
    const ts = [agoH(1), agoH(2), agoH(3), agoH(5), agoH(40)]; // recent half (<=36h): 4, prior: 1
    expect(classifyMomentum(ts, now, 72)).toBe('breaking');
  });
  it('is escalating when rising but low volume', () => {
    const ts = [agoH(1), agoH(2), agoH(50)]; // recent 2, prior 1 -> ratio 2, recent<4
    expect(classifyMomentum(ts, now, 72)).toBe('escalating');
  });
  it('is developing when roughly steady', () => {
    const ts = [agoH(10), agoH(12), agoH(40), agoH(45)]; // recent 2, prior 2 -> ratio 1
    expect(classifyMomentum(ts, now, 72)).toBe('developing');
  });
});

describe('worthReadingScore', () => {
  it('ranks higher velocity + more sources + fresher higher', () => {
    const hot = worthReadingScore({ velocity: 3, sourceCount: 5, lastSeen: agoH(1), now });
    const cold = worthReadingScore({ velocity: 0.5, sourceCount: 1, lastSeen: agoH(40), now });
    expect(hot).toBeGreaterThan(cold);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/server/topic-signals.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/server/topic-signals.ts
import 'server-only';

export type Momentum = 'breaking' | 'escalating' | 'developing' | 'steady' | 'quiet';

const HOUR_MS = 3_600_000;
const BREAKING_MIN_RECENT = 4; // need real volume before calling something "breaking"
const RECENCY_HALF_LIFE_H = 24;

/** Articles per hour over the recent window. */
export function velocityPerHour(timestamps: number[], now: number, windowH: number): number {
  const cutoff = now - windowH * HOUR_MS;
  const recent = timestamps.filter((t) => t >= cutoff).length;
  return recent / windowH;
}

/** Compare the recent half-window to the prior half-window to classify momentum. */
export function classifyMomentum(timestamps: number[], now: number, windowH: number): Momentum {
  const half = (windowH * HOUR_MS) / 2;
  const recent = timestamps.filter((t) => t >= now - half).length;
  const prior = timestamps.filter((t) => t >= now - 2 * half && t < now - half).length;
  if (recent === 0) return 'quiet';
  const ratio = prior === 0 ? Infinity : recent / prior;
  if (recent >= BREAKING_MIN_RECENT && ratio >= 2) return 'breaking';
  if (ratio >= 1.5) return 'escalating';
  if (ratio >= 0.75) return 'developing';
  return 'steady';
}

/** Worth-reading rank: velocity + source diversity, decayed by recency. */
export function worthReadingScore(input: { velocity: number; sourceCount: number; lastSeen: number; now: number }): number {
  const ageH = Math.max(0, (input.now - input.lastSeen) / HOUR_MS);
  const recency = Math.pow(0.5, ageH / RECENCY_HALF_LIFE_H);
  return (input.velocity * 2 + input.sourceCount) * recency;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/server/topic-signals.test.ts`
Expected: PASS (4 describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add lib/server/topic-signals.ts lib/server/topic-signals.test.ts
git commit -m "feat(topics): deterministic velocity/momentum/score signals"
```

---

## Task 3: IDF entity corroboration for topics — `topic-corroboration.ts`

**Files:**
- Create: `lib/server/topic-corroboration.ts`
- Test: `lib/server/topic-corroboration.test.ts`

This mirrors the proven `story-corroboration.ts` but joins `topic_articles`. (Phase 2 unifies the two once `stories` is retired.)

- [ ] **Step 1: Write the failing test**

```ts
// lib/server/topic-corroboration.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
vi.mock('server-only', () => ({}));
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE articles (id TEXT PRIMARY KEY);
  CREATE TABLE article_entities (article_id TEXT, entity_id TEXT, PRIMARY KEY(article_id, entity_id));
  CREATE TABLE topic_articles (topic_id TEXT, article_id TEXT, added_at TEXT NOT NULL, PRIMARY KEY(topic_id, article_id));
`);
vi.mock('./db', async (orig) => ({ ...(await orig() as object), getDb: () => db }));
import { topicEntityOverlapScore, articleCorroboratesTopic, MIN_OVERLAP_IDF } from './topic-corroboration';

const CORPUS = 10_000;
beforeEach(() => {
  db.exec('DELETE FROM articles; DELETE FROM article_entities; DELETE FROM topic_articles;');
  const ins = db.prepare('INSERT INTO articles (id) VALUES (?)');
  for (let i = 0; i < CORPUS; i += 1) ins.run(`c-${i}`);
});
function setDf(entity: string, count: number) {
  const link = db.prepare('INSERT OR IGNORE INTO article_entities (article_id, entity_id) VALUES (?, ?)');
  for (let i = 0; i < count; i += 1) link.run(`c-${i}`, entity);
}

describe('topic corroboration', () => {
  it('merges on one rare shared entity', () => {
    setDf('AcmeCorp', 2);
    db.exec(`INSERT INTO topic_articles (topic_id, article_id, added_at) VALUES ('t1','a0','t');
             INSERT INTO article_entities (article_id, entity_id) VALUES ('a0','AcmeCorp'),('a1','AcmeCorp');`);
    expect(articleCorroboratesTopic('a1', 't1')).toBe(true);
  });
  it('does not merge on a single common entity', () => {
    setDf('USA', 2000);
    db.exec(`INSERT INTO topic_articles (topic_id, article_id, added_at) VALUES ('t1','a0','t');
             INSERT INTO article_entities (article_id, entity_id) VALUES ('a0','USA'),('a1','USA');`);
    expect(articleCorroboratesTopic('a1', 't1')).toBe(false);
  });
  it('fails closed when the article has no entities', () => {
    db.exec(`INSERT INTO topic_articles (topic_id, article_id, added_at) VALUES ('t1','a0','t');
             INSERT INTO article_entities (article_id, entity_id) VALUES ('a0','x');`);
    expect(topicEntityOverlapScore('a1', 't1')).toBe(0);
    expect(MIN_OVERLAP_IDF).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/server/topic-corroboration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/server/topic-corroboration.ts
import 'server-only';
import { getDb } from './db';

export const MIN_OVERLAP_IDF = 5.0;

/** Summed IDF (ln(total/df)) of entities the article shares with any member of the topic. */
export function topicEntityOverlapScore(articleId: string, topicId: string): number {
  try {
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) AS n FROM articles').get() as { n: number }).n || 1;
    const rows = db.prepare(
      `SELECT aa.entity_id AS id,
              (SELECT COUNT(DISTINCT article_id) FROM article_entities WHERE entity_id = aa.entity_id) AS df
       FROM article_entities aa
       JOIN article_entities se ON se.entity_id = aa.entity_id
       JOIN topic_articles ta ON ta.article_id = se.article_id
       WHERE aa.article_id = ? AND ta.topic_id = ?
       GROUP BY aa.entity_id`,
    ).all(articleId, topicId) as Array<{ id: string; df: number }>;
    let score = 0;
    for (const r of rows) {
      const df = Math.max(1, r.df);
      const idf = Math.log(total / df);
      if (idf > 0) score += idf;
    }
    return score;
  } catch {
    return 0;
  }
}

export function articleCorroboratesTopic(articleId: string, topicId: string): boolean {
  return topicEntityOverlapScore(articleId, topicId) >= MIN_OVERLAP_IDF;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/server/topic-corroboration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/server/topic-corroboration.ts lib/server/topic-corroboration.test.ts
git commit -m "feat(topics): IDF entity-overlap corroboration for topics"
```

---

## Task 4: Topics repository — CRUD, candidates, signals, archival

**Files:**
- Create: `lib/server/topics-repository.ts`
- Test: `lib/server/topics-repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/server/topics-repository.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
vi.mock('server-only', () => ({}));
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE articles (id TEXT PRIMARY KEY, title TEXT, source_title TEXT, published_at TEXT, created_at TEXT);
  CREATE TABLE article_entities (article_id TEXT, entity_id TEXT, PRIMARY KEY(article_id, entity_id));
`);
vi.mock('./db', async (orig) => ({ ...(await orig() as object), getDb: () => db }));
import { applyTopicsSchema } from './db';
applyTopicsSchema(db);
import {
  createTopic, attachArticleToTopic, getActiveTopicCentroids,
  getEntityAnchoredTopicCentroids, recomputeTopicSignals, archiveStaleTopics, windowStartIso,
} from './topics-repository';

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
beforeEach(() => {
  db.exec('DELETE FROM topics; DELETE FROM topic_articles; DELETE FROM articles; DELETE FROM article_entities;');
});

describe('topics repository', () => {
  it('creates a topic and lists it as an active centroid', () => {
    db.prepare('INSERT INTO articles (id,title,source_title,published_at) VALUES (?,?,?,?)').run('a0', 'Quake', 'BBC', iso(1000));
    const id = createTopic({ articleId: 'a0', title: 'Quake', embedding: [1, 0, 0], occurredAt: iso(1000), sourceTitle: 'BBC' });
    const cands = getActiveTopicCentroids(10, windowStartIso());
    expect(cands.map((c) => c.id)).toContain(id);
    expect(cands.find((c) => c.id === id)!.centroid).toEqual([1, 0, 0]);
  });

  it('attach updates the running-mean centroid and counts', () => {
    db.prepare('INSERT INTO articles (id,title,source_title,published_at) VALUES (?,?,?,?)').run('a0', 'Quake', 'BBC', iso(2000));
    db.prepare('INSERT INTO articles (id,title,source_title,published_at) VALUES (?,?,?,?)').run('a1', 'Quake 2', 'CNN', iso(1000));
    const id = createTopic({ articleId: 'a0', title: 'Quake', embedding: [2, 0, 0], occurredAt: iso(2000), sourceTitle: 'BBC' });
    attachArticleToTopic({ topicId: id, articleId: 'a1', embedding: [0, 2, 0], occurredAt: iso(1000) });
    recomputeTopicSignals(id);
    const row = db.prepare('SELECT article_count AS c, source_count AS s FROM topics WHERE id=?').get(id) as { c: number; s: number };
    expect(row).toEqual({ c: 2, s: 2 });
    const centroid = JSON.parse((db.prepare('SELECT centroid FROM topics WHERE id=?').get(id) as { centroid: string }).centroid);
    expect(centroid).toEqual([1, 1, 0]); // mean of [2,0,0] and [0,2,0]
  });

  it('finds an entity-anchored candidate by a selective shared entity', () => {
    db.prepare('INSERT INTO articles (id,title,published_at) VALUES (?,?,?)').run('a0', 'X', iso(1000));
    const id = createTopic({ articleId: 'a0', title: 'X', embedding: [1, 0, 0], occurredAt: iso(1000), sourceTitle: null });
    db.exec(`INSERT INTO article_entities (article_id, entity_id) VALUES ('a0','Acme'),('incoming','Acme');`);
    const cands = getEntityAnchoredTopicCentroids('incoming', 50, 10, windowStartIso());
    expect(cands.map((c) => c.id)).toContain(id);
  });

  it('archives topics whose last_seen is outside the window', () => {
    db.prepare('INSERT INTO articles (id,title,published_at) VALUES (?,?,?)').run('old', 'Old', iso(200 * 3600_000));
    const id = createTopic({ articleId: 'old', title: 'Old', embedding: [1, 0, 0], occurredAt: iso(200 * 3600_000), sourceTitle: null });
    const archived = archiveStaleTopics(windowStartIso());
    expect(archived).toBe(1);
    expect((db.prepare('SELECT status FROM topics WHERE id=?').get(id) as { status: string }).status).toBe('archived');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/server/topics-repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/server/topics-repository.ts
import 'server-only';
import { nanoid } from 'nanoid';
import { getDb } from './db';
import { runningMean } from './vector-math';
import { velocityPerHour, classifyMomentum, worthReadingScore } from './topic-signals';

export const TOPIC_WINDOW_HOURS = 72;
const HOUR_MS = 3_600_000;

export interface TopicCentroid { id: string; centroid: number[]; lastSeenAt: string; }

export function windowStartIso(now = Date.now(), windowH = TOPIC_WINDOW_HOURS): string {
  return new Date(now - windowH * HOUR_MS).toISOString();
}

export function createTopic(input: {
  articleId: string; title: string; embedding: number[]; occurredAt: string; sourceTitle: string | null;
}): string {
  const db = getDb();
  const id = nanoid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO topics (id, status, centroid, representative_article_id, top_line,
       article_count, source_count, first_seen_at, last_seen_at, velocity, momentum, score,
       summary_state, summary_article_count, created_at, updated_at)
     VALUES (?, 'active', ?, ?, ?, 1, 1, ?, ?, 0, 'steady', 0, 'none', 0, ?, ?)`,
  ).run(id, JSON.stringify(input.embedding), input.articleId, input.title, input.occurredAt, input.occurredAt, now, now);
  db.prepare('INSERT OR IGNORE INTO topic_articles (topic_id, article_id, added_at) VALUES (?, ?, ?)')
    .run(id, input.articleId, input.occurredAt);
  return id;
}

export function attachArticleToTopic(input: {
  topicId: string; articleId: string; embedding: number[]; occurredAt: string;
}): boolean {
  const db = getDb();
  const link = db.prepare('INSERT OR IGNORE INTO topic_articles (topic_id, article_id, added_at) VALUES (?, ?, ?)')
    .run(input.topicId, input.articleId, input.occurredAt) as { changes: number };
  if (link.changes === 0) return false;
  const t = db.prepare('SELECT centroid, article_count AS c FROM topics WHERE id = ?').get(input.topicId) as { centroid: string | null; c: number } | undefined;
  if (!t) return false;
  const current = t.centroid ? (JSON.parse(t.centroid) as number[]) : null;
  const next = runningMean(current, input.embedding, t.c);
  db.prepare(`UPDATE topics SET centroid = ?, article_count = article_count + 1, last_seen_at = ?, status = 'active', updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(next), input.occurredAt, new Date().toISOString(), input.topicId);
  return true;
}

export function getActiveTopicCentroids(limit: number, windowStart: string): TopicCentroid[] {
  const rows = getDb().prepare(
    `SELECT id, centroid, last_seen_at AS lastSeenAt FROM topics
     WHERE status = 'active' AND centroid IS NOT NULL AND last_seen_at >= ?
     ORDER BY last_seen_at DESC LIMIT ?`,
  ).all(windowStart, limit) as Array<{ id: string; centroid: string; lastSeenAt: string }>;
  return rows.map((r) => ({ id: r.id, centroid: JSON.parse(r.centroid) as number[], lastSeenAt: r.lastSeenAt }));
}

export function getEntityAnchoredTopicCentroids(articleId: string, entityDfCap: number, limit: number, windowStart: string): TopicCentroid[] {
  const rows = getDb().prepare(
    `SELECT DISTINCT t.id, t.centroid, t.last_seen_at AS lastSeenAt
     FROM article_entities ae
     JOIN article_entities se ON se.entity_id = ae.entity_id
     JOIN topic_articles ta ON ta.article_id = se.article_id
     JOIN topics t ON t.id = ta.topic_id
     WHERE ae.article_id = ? AND t.status = 'active' AND t.centroid IS NOT NULL AND t.last_seen_at >= ?
       AND (SELECT COUNT(DISTINCT article_id) FROM article_entities WHERE entity_id = ae.entity_id) <= ?
     LIMIT ?`,
  ).all(articleId, windowStart, entityDfCap, limit) as Array<{ id: string; centroid: string; lastSeenAt: string }>;
  return rows.map((r) => ({ id: r.id, centroid: JSON.parse(r.centroid) as number[], lastSeenAt: r.lastSeenAt }));
}

/** Recompute denormalized signals + deterministic top-line from current membership. */
export function recomputeTopicSignals(topicId: string, now = Date.now(), windowH = TOPIC_WINDOW_HOURS): void {
  const db = getDb();
  const ts = (db.prepare('SELECT added_at FROM topic_articles WHERE topic_id = ?').all(topicId) as Array<{ added_at: string }>)
    .map((r) => Date.parse(r.added_at)).filter((n) => Number.isFinite(n));
  const velocity = velocityPerHour(ts, now, windowH);
  const momentum = classifyMomentum(ts, now, windowH);
  const lastSeen = ts.length ? Math.max(...ts) : now;
  const sourceCount = (db.prepare(
    `SELECT COUNT(DISTINCT a.source_title) AS n FROM topic_articles ta JOIN articles a ON a.id = ta.article_id WHERE ta.topic_id = ?`,
  ).get(topicId) as { n: number }).n || 0;
  const score = worthReadingScore({ velocity, sourceCount, lastSeen, now });
  const lead = db.prepare(
    `SELECT a.title FROM topic_articles ta JOIN articles a ON a.id = ta.article_id WHERE ta.topic_id = ? ORDER BY a.published_at ASC LIMIT 1`,
  ).get(topicId) as { title: string } | undefined;
  db.prepare(
    `UPDATE topics SET velocity = ?, momentum = ?, score = ?, source_count = ?, article_count = ?, top_line = COALESCE(?, top_line), updated_at = ? WHERE id = ?`,
  ).run(velocity, momentum, score, sourceCount, ts.length, lead?.title ?? null, new Date().toISOString(), topicId);
}

export function archiveStaleTopics(windowStart: string): number {
  const r = getDb().prepare(`UPDATE topics SET status = 'archived', updated_at = ? WHERE status = 'active' AND last_seen_at < ?`)
    .run(new Date().toISOString(), windowStart) as { changes: number };
  return r.changes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/server/topics-repository.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/topics-repository.ts lib/server/topics-repository.test.ts
git commit -m "feat(topics): topics repository — CRUD, candidates, signals, archival"
```

---

## Task 5: Topic assignment — `topic-assignment.ts`

**Files:**
- Create: `lib/server/topic-assignment.ts`
- Test: `lib/server/topic-assignment.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/server/topic-assignment.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
vi.mock('server-only', () => ({}));
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE articles (id TEXT PRIMARY KEY, title TEXT, source_title TEXT, published_at TEXT, created_at TEXT);
  CREATE TABLE article_entities (article_id TEXT, entity_id TEXT, PRIMARY KEY(article_id, entity_id));
`);
vi.mock('./db', async (orig) => ({ ...(await orig() as object), getDb: () => db }));
import { applyTopicsSchema } from './db';
applyTopicsSchema(db);
import { assignArticleToTopic, TOPIC_SIM_THRESHOLD } from './topic-assignment';

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const CORPUS = 1000;
beforeEach(() => {
  db.exec('DELETE FROM topics; DELETE FROM topic_articles; DELETE FROM articles; DELETE FROM article_entities;');
  const ins = db.prepare('INSERT INTO articles (id,title,published_at) VALUES (?,?,?)');
  for (let i = 0; i < CORPUS; i += 1) ins.run(`c-${i}`, 'corpus', iso(1000));
});

describe('assignArticleToTopic', () => {
  it('creates a new topic when there are no candidates', () => {
    db.prepare('INSERT INTO articles (id,title,published_at) VALUES (?,?,?)').run('a1', 'Quake', iso(1000));
    const r = assignArticleToTopic({ articleId: 'a1', title: 'Quake', snippet: 's', occurredAt: iso(1000), embedding: [1, 0, 0], sourceTitle: 'BBC' });
    expect(r.created).toBe(true);
  });

  it('merges into a similar topic when a rare entity corroborates', () => {
    db.prepare('INSERT INTO articles (id,title,published_at) VALUES (?,?,?)').run('a0', 'Quake', iso(2000));
    db.prepare('INSERT INTO articles (id,title,published_at) VALUES (?,?,?)').run('a1', 'Quake 2', iso(1000));
    const first = assignArticleToTopic({ articleId: 'a0', title: 'Quake', snippet: 's', occurredAt: iso(2000), embedding: [1, 0, 0], sourceTitle: 'BBC' });
    db.exec(`INSERT INTO article_entities (article_id, entity_id) VALUES ('a0','quakeCo'),('a1','quakeCo');`);
    const r = assignArticleToTopic({ articleId: 'a1', title: 'Quake 2', snippet: 's', occurredAt: iso(1000), embedding: [0.99, 0.01, 0], sourceTitle: 'CNN' });
    expect(r.created).toBe(false);
    expect(r.topicId).toBe(first.topicId);
  });

  it('does NOT merge on high cosine alone without entity overlap', () => {
    db.prepare('INSERT INTO articles (id,title,published_at) VALUES (?,?,?)').run('a0', 'Filing A', iso(2000));
    db.prepare('INSERT INTO articles (id,title,published_at) VALUES (?,?,?)').run('a1', 'Filing B', iso(1000));
    assignArticleToTopic({ articleId: 'a0', title: 'Filing A', snippet: 's', occurredAt: iso(2000), embedding: [1, 0, 0], sourceTitle: 'X' });
    const r = assignArticleToTopic({ articleId: 'a1', title: 'Filing B', snippet: 's', occurredAt: iso(1000), embedding: [0.99, 0.01, 0], sourceTitle: 'Y' });
    expect(r.created).toBe(true);
  });

  it('is idempotent for the same article id', () => {
    db.prepare('INSERT INTO articles (id,title,published_at) VALUES (?,?,?)').run('dup', 'D', iso(1000));
    const r1 = assignArticleToTopic({ articleId: 'dup', title: 'D', snippet: 's', occurredAt: iso(1000), embedding: [1, 0, 0], sourceTitle: null });
    const r2 = assignArticleToTopic({ articleId: 'dup', title: 'D', snippet: 's', occurredAt: iso(1000), embedding: [1, 0, 0], sourceTitle: null });
    expect(r2.topicId).toBe(r1.topicId);
    expect((db.prepare('SELECT COUNT(*) AS c FROM topics').get() as { c: number }).c).toBe(1);
  });

  it('exposes the similarity threshold', () => {
    expect(TOPIC_SIM_THRESHOLD).toBe(0.83);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/server/topic-assignment.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/server/topic-assignment.ts
import 'server-only';
import { cosineSimilarity } from './vector-math';
import { getDb } from './db';
import {
  createTopic, attachArticleToTopic, recomputeTopicSignals,
  getActiveTopicCentroids, getEntityAnchoredTopicCentroids, windowStartIso, type TopicCentroid,
} from './topics-repository';
import { articleCorroboratesTopic } from './topic-corroboration';

export const TOPIC_SIM_THRESHOLD = 0.83;
const CANDIDATE_LIMIT = 100;
const CANDIDATE_ENTITY_DF_FRACTION = 0.02;

export interface AssignTopicInput {
  articleId: string; title: string; snippet: string; occurredAt: string; embedding: number[]; sourceTitle: string | null;
}
export interface AssignTopicResult { topicId: string; created: boolean; skipped?: boolean; }

export function assignArticleToTopic(input: AssignTopicInput): AssignTopicResult {
  if (!input.embedding || input.embedding.length === 0) return { topicId: '', created: false, skipped: true };
  const db = getDb();
  const existing = db.prepare('SELECT topic_id AS id FROM topic_articles WHERE article_id = ? LIMIT 1').get(input.articleId) as { id: string } | undefined;
  if (existing) return { topicId: existing.id, created: false };

  const windowStart = windowStartIso();
  const total = (db.prepare('SELECT COUNT(*) AS n FROM articles').get() as { n: number }).n || 1;
  const entityCap = Math.max(50, Math.floor(total * CANDIDATE_ENTITY_DF_FRACTION));

  const candidates = new Map<string, TopicCentroid>();
  for (const c of getActiveTopicCentroids(CANDIDATE_LIMIT, windowStart)) candidates.set(c.id, c);
  for (const c of getEntityAnchoredTopicCentroids(input.articleId, entityCap, CANDIDATE_LIMIT, windowStart)) candidates.set(c.id, c);

  let best: { id: string; sim: number } | null = null;
  for (const cand of candidates.values()) {
    const sim = cosineSimilarity(input.embedding, cand.centroid);
    if (sim < TOPIC_SIM_THRESHOLD) continue;
    if (!articleCorroboratesTopic(input.articleId, cand.id)) continue;
    if (!best || sim > best.sim) best = { id: cand.id, sim };
  }

  if (best) {
    attachArticleToTopic({ topicId: best.id, articleId: input.articleId, embedding: input.embedding, occurredAt: input.occurredAt });
    recomputeTopicSignals(best.id);
    return { topicId: best.id, created: false };
  }
  const id = createTopic({ articleId: input.articleId, title: input.title, embedding: input.embedding, occurredAt: input.occurredAt, sourceTitle: input.sourceTitle });
  recomputeTopicSignals(id);
  return { topicId: id, created: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/server/topic-assignment.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/topic-assignment.ts lib/server/topic-assignment.test.ts
git commit -m "feat(topics): deterministic article->topic assignment"
```

---

## Task 6: Batch digestion + read model — `topic-digestion.ts` and repository reads

**Files:**
- Create: `lib/server/topic-digestion.ts`
- Modify: `lib/server/topics-repository.ts` (add `getRankedTopics`, `getTrendingTags`, `RankedTopic`, `TrendingTag`)
- Test: `lib/server/topics-repository.read.test.ts`

- [ ] **Step 1: Write the failing test (read model)**

```ts
// lib/server/topics-repository.read.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
vi.mock('server-only', () => ({}));
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE articles (id TEXT PRIMARY KEY, title TEXT, source_title TEXT, published_at TEXT, created_at TEXT);
  CREATE TABLE entities (id TEXT PRIMARY KEY, name TEXT, entity_type TEXT);
  CREATE TABLE article_entities (article_id TEXT, entity_id TEXT, PRIMARY KEY(article_id, entity_id));
`);
vi.mock('./db', async (orig) => ({ ...(await orig() as object), getDb: () => db }));
import { applyTopicsSchema } from './db';
applyTopicsSchema(db);
import { getRankedTopics, getTrendingTags, windowStartIso } from './topics-repository';

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
beforeEach(() => {
  db.exec('DELETE FROM topics; DELETE FROM articles; DELETE FROM entities; DELETE FROM article_entities;');
});

describe('topics read model', () => {
  it('returns active topics ordered by score desc', () => {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO topics (id,status,top_line,article_count,source_count,first_seen_at,last_seen_at,velocity,momentum,score,summary_state,summary_article_count,created_at,updated_at)
      VALUES ('low','active','Low',2,1,?,?,0.2,'steady',1,'none',0,?,?),('high','active','High',9,4,?,?,3,'escalating',50,'none',0,?,?)`).run(iso(1000), iso(1000), now, now, iso(500), iso(500), now, now);
    db.prepare(`INSERT INTO topics (id,status,top_line,article_count,source_count,first_seen_at,last_seen_at,velocity,momentum,score,summary_state,summary_article_count,created_at,updated_at)
      VALUES ('old','archived','Old',5,2,?,?,0,'quiet',99,'none',0,?,?)`).run(iso(99999999), iso(99999999), now, now);
    const ranked = getRankedTopics(10, windowStartIso());
    expect(ranked.map((t) => t.id)).toEqual(['high', 'low']); // archived excluded, sorted by score
  });

  it('returns trending tags by windowed article count', () => {
    db.prepare('INSERT INTO articles (id,published_at) VALUES (?,?)').run('a0', iso(1000));
    db.prepare('INSERT INTO articles (id,published_at) VALUES (?,?)').run('a1', iso(2000));
    db.prepare('INSERT INTO entities (id,name,entity_type) VALUES (?,?,?)').run('e1', 'Iran', 'location');
    db.exec(`INSERT INTO article_entities (article_id, entity_id) VALUES ('a0','e1'),('a1','e1');`);
    const tags = getTrendingTags(10, windowStartIso());
    expect(tags[0]).toMatchObject({ name: 'Iran', count: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/server/topics-repository.read.test.ts`
Expected: FAIL — `getRankedTopics` / `getTrendingTags` not exported.

- [ ] **Step 3: Implement read model (append to `topics-repository.ts`)**

```ts
// lib/server/topics-repository.ts — append
export interface RankedTopic {
  id: string; topLine: string | null; articleCount: number; sourceCount: number;
  velocity: number; momentum: string; score: number; lastSeenAt: string; summary: string | null;
}
export function getRankedTopics(limit: number, windowStart: string): RankedTopic[] {
  return getDb().prepare(
    `SELECT id, top_line AS topLine, article_count AS articleCount, source_count AS sourceCount,
            velocity, momentum, score, last_seen_at AS lastSeenAt, summary
     FROM topics WHERE status = 'active' AND last_seen_at >= ?
     ORDER BY score DESC LIMIT ?`,
  ).all(windowStart, limit) as RankedTopic[];
}

export interface TrendingTag { name: string; type: string; count: number; }
export function getTrendingTags(limit: number, windowStart: string): TrendingTag[] {
  return getDb().prepare(
    `SELECT e.name, e.entity_type AS type, COUNT(DISTINCT ae.article_id) AS count
     FROM article_entities ae
     JOIN entities e ON e.id = ae.entity_id
     JOIN articles a ON a.id = ae.article_id
     WHERE COALESCE(a.published_at, a.created_at) >= ?
     GROUP BY e.id ORDER BY count DESC LIMIT ?`,
  ).all(windowStart, limit) as TrendingTag[];
}
```

- [ ] **Step 4: Run read test to verify it passes**

Run: `npx vitest run lib/server/topics-repository.read.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `topic-digestion.ts` (no separate unit test — exercised by the integration test in Task 7)**

```ts
// lib/server/topic-digestion.ts
import 'server-only';
import { getDb } from './db';
import { extractEntitiesDeterministic } from './entity-extraction';
import { upsertEntitiesForArticle } from './entities-repository';
import { assignArticleToTopic } from './topic-assignment';

interface Row {
  id: string; title: string; content_snippet: string | null; raw_content: string | null;
  source_title: string | null; published_at: string | null; created_at: string | null; embedding: string;
}

/**
 * Digest window articles that have an embedding but are not yet in any topic, oldest-first.
 * Deterministic only: ensures tags exist, then assigns to a topic. No LLM.
 */
export function digestRecentArticles(windowStart: string, limit = 2000): { digested: number } {
  const db = getDb();
  const rows = db.prepare(
    `SELECT a.id, a.title, a.content_snippet, a.raw_content, a.source_title, a.published_at, a.created_at,
            vec_to_json(av.embedding) AS embedding
     FROM articles a
     JOIN article_vectors av ON av.article_id = a.id
     LEFT JOIN topic_articles ta ON ta.article_id = a.id
     WHERE ta.article_id IS NULL AND COALESCE(a.published_at, a.created_at) >= ?
     ORDER BY COALESCE(a.published_at, a.created_at) ASC
     LIMIT ?`,
  ).all(windowStart, limit) as Row[];

  let digested = 0;
  for (const r of rows) {
    let embedding: number[];
    try { embedding = JSON.parse(r.embedding) as number[]; } catch { continue; }
    if (!Array.isArray(embedding) || embedding.length === 0) continue;
    const occurredAt = r.published_at || r.created_at || new Date().toISOString();
    const content = `${r.content_snippet || ''}\n${r.raw_content || ''}`.trim();
    try { upsertEntitiesForArticle(r.id, occurredAt, extractEntitiesDeterministic(r.title, content)); } catch { /* best-effort tags */ }
    assignArticleToTopic({ articleId: r.id, title: r.title, snippet: (r.content_snippet || '').slice(0, 400), occurredAt, embedding, sourceTitle: r.source_title });
    digested += 1;
  }
  return { digested };
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/server/topics-repository.ts lib/server/topics-repository.read.test.ts lib/server/topic-digestion.ts
git commit -m "feat(topics): batch digestion + ranked-topics/trending-tags read model"
```

---

## Task 7: Integration test — window of articles → topics + signals

**Files:**
- Test: `lib/server/topic-digestion.integration.test.ts`

This proves the end-to-end deterministic pipeline on synthetic data, including that genre-similar-but-unrelated articles do NOT merge and a shared-entity burst DOES.

- [ ] **Step 1: Write the failing test**

```ts
// lib/server/topic-digestion.integration.test.ts
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import * as sqliteVec from 'sqlite-vec';
vi.mock('server-only', () => ({}));
const db = new DatabaseSync(':memory:', { allowExtension: true });
db.loadExtension(sqliteVec.getLoadablePath());
db.exec(`
  CREATE TABLE articles (id TEXT PRIMARY KEY, title TEXT, content_snippet TEXT, raw_content TEXT, source_title TEXT, published_at TEXT, created_at TEXT);
  CREATE VIRTUAL TABLE article_vectors USING vec0(article_id TEXT PRIMARY KEY, embedding float[3]);
  CREATE TABLE entities (id TEXT PRIMARY KEY, name TEXT, normalized_name TEXT UNIQUE, entity_type TEXT, created_at TEXT, updated_at TEXT, aliases TEXT, summary TEXT, salience REAL DEFAULT 0, mention_count INTEGER DEFAULT 0, first_seen TEXT, last_seen TEXT, summary_dirty_count INTEGER DEFAULT 0, summary_updated_at TEXT);
  CREATE TABLE article_entities (article_id TEXT, entity_id TEXT, mention_count INTEGER NOT NULL DEFAULT 1, weight REAL NOT NULL DEFAULT 1, salience REAL, sentiment REAL, snippet TEXT, PRIMARY KEY(article_id, entity_id));
`);
vi.mock('./db', async (orig) => ({ ...(await orig() as object), getDb: () => db }));
import { applyTopicsSchema } from './db';
applyTopicsSchema(db);
import { digestRecentArticles } from './topic-digestion';
import { getRankedTopics, windowStartIso } from './topics-repository';

const iso = (hAgo: number) => new Date(Date.now() - hAgo * 3_600_000).toISOString();
function addArticle(id: string, title: string, vec: number[], hAgo: number, source: string) {
  db.prepare('INSERT INTO articles (id,title,content_snippet,raw_content,source_title,published_at) VALUES (?,?,?,?,?,?)')
    .run(id, title, title, '', source, iso(hAgo));
  db.prepare('INSERT INTO article_vectors (article_id, embedding) VALUES (?, ?)').run(id, new Float32Array(vec));
}

beforeAll(() => {
  // Topic A: an escalating burst about "Acme" — same entity, same vector neighborhood.
  for (let i = 0; i < 5; i += 1) addArticle(`acme-${i}`, `Acme deal update ${i}`, [1, 0, 0], 5 - i, `src${i}`);
  // Topic B: one unrelated article in a different vector neighborhood.
  addArticle('weather', 'Storm hits coast', [0, 1, 0], 2, 'srcW');
  digestRecentArticles(windowStartIso(), 100);
});

describe('digestion integration', () => {
  it('groups the Acme burst into one topic and keeps the unrelated article separate', () => {
    const ranked = getRankedTopics(10, windowStartIso());
    const sizes = ranked.map((t) => t.articleCount).sort((a, b) => b - a);
    expect(sizes[0]).toBe(5);          // Acme burst clustered
    expect(ranked.length).toBe(2);     // plus the lone weather article
  });

  it('flags the burst as escalating/breaking, not quiet', () => {
    const ranked = getRankedTopics(10, windowStartIso());
    const acme = ranked.find((t) => t.articleCount === 5)!;
    expect(['escalating', 'breaking', 'developing']).toContain(acme.momentum);
    expect(acme.score).toBeGreaterThan(0);
  });
});
```

> Note: `digestRecentArticles` calls `extractEntitiesDeterministic`, which yields no entities for the synthetic Latin titles — so clustering here is corroborated by the **vector neighborhood only via** the shared-entity gate failing closed. To make the Acme burst merge in this test, the test seeds the shared entity explicitly. Add this to `beforeAll` AFTER inserting articles and BEFORE `digestRecentArticles`:

```ts
  db.prepare('INSERT INTO entities (id,name,normalized_name,entity_type,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run('acme', 'Acme', 'acme', 'organization', iso(0), iso(0));
  for (let i = 0; i < 5; i += 1) db.prepare('INSERT INTO article_entities (article_id, entity_id) VALUES (?, ?)').run(`acme-${i}`, 'acme');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/server/topic-digestion.integration.test.ts`
Expected: FAIL initially if any wiring is off; iterate until it passes. (If `extractEntitiesDeterministic` import pulls `server-only`, the top `vi.mock('server-only')` covers it.)

- [ ] **Step 3: Make it pass**

No new production code should be required — this test exercises Tasks 1-6. If it fails, the bug is in those tasks; fix there. Do not add test-only branches to production code.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS (all prior + these).

- [ ] **Step 5: Commit**

```bash
git add lib/server/topic-digestion.integration.test.ts
git commit -m "test(topics): end-to-end digestion integration on synthetic window"
```

---

## Task 8: Read + rebuild API routes

**Files:**
- Create: `app/api/digest/route.ts`
- Create: `app/api/digest/rebuild/route.ts`

- [ ] **Step 1: Implement the read route**

```ts
// app/api/digest/route.ts
import { NextResponse } from 'next/server';
import { getRankedTopics, getTrendingTags, windowStartIso } from '@/lib/server/topics-repository';

export const dynamic = 'force-dynamic';

export async function GET() {
  const windowStart = windowStartIso();
  const topics = getRankedTopics(50, windowStart);
  const trending = getTrendingTags(20, windowStart);
  const breaking = topics.filter((t) => t.momentum === 'breaking').length;
  const escalating = topics.filter((t) => t.momentum === 'escalating').length;
  return NextResponse.json({
    topics, trending,
    meta: { total: topics.length, breaking, escalating, generatedAt: new Date().toISOString() },
  });
}
```

- [ ] **Step 2: Implement the rebuild route**

```ts
// app/api/digest/rebuild/route.ts
import { NextResponse } from 'next/server';
import { digestRecentArticles } from '@/lib/server/topic-digestion';
import { archiveStaleTopics, windowStartIso } from '@/lib/server/topics-repository';

export const dynamic = 'force-dynamic';

export async function POST() {
  const windowStart = windowStartIso();
  const { digested } = digestRecentArticles(windowStart, 5000);
  const archived = archiveStaleTopics(windowStart);
  return NextResponse.json({ ok: true, digested, archived });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Manual smoke test against the dev server**

```bash
# Build topics from the last-window articles (deterministic, no LLM):
curl -s -X POST http://localhost:3001/api/digest/rebuild
# Expect: {"ok":true,"digested":<n>,"archived":<m>}
curl -s http://localhost:3001/api/digest | python3 -c "import sys,json;d=json.load(sys.stdin);print('topics',d['meta']['total'],'breaking',d['meta']['breaking'],'escalating',d['meta']['escalating']);[print('-',t['articleCount'],t['momentum'],(t['topLine'] or '')[:50]) for t in d['topics'][:8]]"
```

Expected: a ranked list of active topics with sane sizes/momentum, returning in well under a second, and trending tags populated.

- [ ] **Step 5: Commit**

```bash
git add app/api/digest/route.ts app/api/digest/rebuild/route.ts
git commit -m "feat(topics): /api/digest read + /api/digest/rebuild endpoints"
```

---

## Self-Review notes

- **Spec coverage:** data model (Task 1), deterministic digestion (Tasks 5-6), signals/ranking (Tasks 2,4,6), windowed candidates + IDF corroboration + clustering (Tasks 3-5), archival (Task 4), read surface (Tasks 6,8), one-time rebuild over the window (Tasks 6,8). Deferred per Phase 1 scope: LLM consumer + summaries, cross-window reactivation, live-worker wiring (Phase 2).
- **Type consistency:** `TopicCentroid` (`id`/`centroid`/`lastSeenAt`), `AssignTopicResult` (`topicId`/`created`/`skipped`), `RankedTopic`/`TrendingTag`, `windowStartIso()` signature, and `Momentum` values are used identically across tasks.
- **No placeholders:** every code step is complete and runnable.

## Validation gate before Phase 2

After Task 8, validate on real data: run `/api/digest/rebuild`, then inspect `/api/digest` for the genre-vs-event quality we verified in the clustering work (US-Iran-style bursts cluster; unrelated filings stay separate) and confirm momentum/score look right. Only then plan Phase 2 (threshold-triggered LLM consumer + cached digest + home cutover + retirement of the old subsystems).
