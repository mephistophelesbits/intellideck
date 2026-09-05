# IntelliDeck 2.0 — Phase 1: Graph Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every newly-ingested article produce (a) a vector embedding stored in `sqlite-vec` and (b) LLM-extracted entities with rolling summaries and salience, then surface that intelligence on a navigable entity page.

**Architecture:** Extend the existing `node:sqlite` schema in place via the established `ensureColumn` migration pattern — no table drops. Add a `sqlite-vec` loadable extension to the single `DatabaseSync` connection for a `vec0` virtual table. Add an `embedText` path to the existing multi-provider `lib/ai/providers.ts` (Ollama `nomic-embed-text`). Upgrade the regex entity extractor in `lib/server/intelligence.ts` to an LLM extractor that falls back to regex on failure, wired into the existing `upsertArticleEnrichment` enrichment pipeline. Surface entities by un-orphaning the already-built `/intelligence` dashboard and adding an `/entity/[id]` page.

**Tech Stack:** Next.js (App Router) + Electron + TypeScript + `node:sqlite` (`DatabaseSync`, Node 24) + `sqlite-vec` + Ollama (`nomic-embed-text` for embeddings, existing curation model for extraction) + Vitest.

**Recorded decisions deferred to Phase 2 (do NOT build here, but do not contradict):**
- The Story view will take the `/` (Today) slot and **replace** the Agent panel ([components/TodayAgentPanel.tsx](../../../components/TodayAgentPanel.tsx)). The Agent is **demoted, not deleted** — it becomes an on-demand slide-in panel summoned from a story/article, preserving the `article_research` handoff at [components/ui/ArticlePreviewPanel.tsx:435](../../../components/ui/ArticlePreviewPanel.tsx) and the Pillar D output reuse. The new Today's priority ranking shifts from per-article `priorityScore` to per-story `salience × interest signal`. All of this is gated on the story graph (Phase 2), so it is out of scope for Phase 1.
- The same `StoryCard` will render in both Today (curated/ranked) and `/raw-feed` (firehose, behind a Stories⇄Raw toggle).

**Phase 1 done when:** every new article produces entities and an embedding, and clicking an entity opens a page showing its rolling summary, salience, and the articles it appears in. `/intelligence` is reachable from the top nav.

---

## File Structure

**Create:**
- `lib/server/article-vectors-repository.ts` — write/query the `article_vectors` vec0 table (upsert embedding, nearest-neighbour search).
- `lib/server/article-vectors-repository.test.ts` — tests for the above.
- `lib/server/entity-extraction.ts` — LLM entity extractor (strict JSON, schema validation, regex fallback).
- `lib/server/entity-extraction.test.ts` — tests for parsing/validation/fallback.
- `lib/server/entities-repository.ts` — entity upsert with alias resolution, salience, first/last seen, mention_count; rolling-summary debounce.
- `lib/server/entities-repository.test.ts` — tests for the above.
- `app/api/intelligence/entity/[id]/route.ts` — entity detail API.
- `app/entity/[id]/page.tsx` — entity detail page.

**Modify:**
- `lib/server/db.ts` — load `sqlite-vec`, create `article_vectors`, extend `entities` + `article_entities` columns.
- `lib/ai/providers.ts` — add `embedText()` (Ollama path).
- `lib/server/articles-repository.ts` — call embedding + LLM entity enrichment from `upsertArticleEnrichment`; extend entity statements.
- `lib/server/intelligence.ts` — export the regex extractor under a name the LLM extractor can call as fallback (no behaviour change).
- `components/ui/TopNavBar.tsx` — add `/intelligence` to the nav.
- `lib/i18n/en.json`, `lib/i18n/zh-CN.json` — nav + entity-page strings.
- `package.json` — add `sqlite-vec` dependency.

---

## Task 1: Add `sqlite-vec` and load it into the DB connection

**Files:**
- Modify: `package.json`
- Modify: `lib/server/db.ts:22-24` (the `initializeDatabase` body / `getDb` open path)

- [ ] **Step 1: Install the dependency**

Run:
```bash
npm install sqlite-vec
```
Expected: `sqlite-vec` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Load the extension and create the vector table**

In `lib/server/db.ts`, add the import at the top (after the existing imports):

```ts
import * as sqliteVec from 'sqlite-vec';
```

Inside `initializeDatabase(db)`, **before** the big `db.exec(\`...\`)` schema string, load the extension:

```ts
  // sqlite-vec: local-first vector store for embeddings (Phase 1 graph foundation).
  // node:sqlite requires enabling extension loading explicitly before loadExtension.
  try {
    db.enableLoadExtension(true);
    db.loadExtension(sqliteVec.getLoadablePath());
    db.enableLoadExtension(false);
  } catch (error) {
    console.error('[db] Failed to load sqlite-vec extension:', error);
    throw error;
  }
```

Then add the virtual table to the existing `db.exec(\`...\`)` schema string, immediately after the `preference_weights` table block (around `lib/server/db.ts:251`):

```sql
    CREATE VIRTUAL TABLE IF NOT EXISTS article_vectors USING vec0(
      article_id TEXT PRIMARY KEY,
      embedding FLOAT[768]
    );
```

- [ ] **Step 3: Verify the extension loads and the table is usable**

Run:
```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const v = require('sqlite-vec');
const d = new DatabaseSync(':memory:');
d.enableLoadExtension(true); d.loadExtension(v.getLoadablePath()); d.enableLoadExtension(false);
d.exec('CREATE VIRTUAL TABLE t USING vec0(id TEXT PRIMARY KEY, embedding FLOAT[3])');
d.prepare('INSERT INTO t(id, embedding) VALUES (?, ?)').run('a', JSON.stringify([0.1,0.2,0.3]));
const row = d.prepare('SELECT id, distance FROM t WHERE embedding MATCH ? ORDER BY distance LIMIT 1').get(JSON.stringify([0.1,0.2,0.3]));
console.log('OK', row);
"
```
Expected: prints `OK { id: 'a', distance: 0 }` (distance is 0 for an identical vector).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json lib/server/db.ts
git commit -m "feat: load sqlite-vec extension and add article_vectors table"
```

---

## Task 2: Add `embedText()` to the provider layer

**Files:**
- Modify: `lib/ai/providers.ts` (add after `generateOllama`, around `lib/ai/providers.ts:92`)

- [ ] **Step 1: Write the failing test**

Create `lib/ai/providers.embed.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { embedText } from './providers';

afterEach(() => vi.restoreAllMocks());

describe('embedText (ollama)', () => {
  it('returns the embedding vector from the Ollama response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ embedding: [0.1, 0.2, 0.3] }), { status: 200 }),
    );
    const vec = await embedText('ollama', 'hello world', { model: 'nomic-embed-text' });
    expect(vec).toEqual([0.1, 0.2, 0.3]);
  });

  it('throws on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(
      embedText('ollama', 'x', { model: 'nomic-embed-text' }),
    ).rejects.toThrow(/Ollama embedding error/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/ai/providers.embed.test.ts`
Expected: FAIL with `embedText is not a function` (or import error).

- [ ] **Step 3: Implement `embedText`**

In `lib/ai/providers.ts`, add after `generateOllama` (after `lib/ai/providers.ts:92`):

```ts
export async function embedText(
    provider: AIProvider,
    text: string,
    options: AIRequestOptions
): Promise<number[]> {
    switch (provider) {
        case 'ollama':
            return await embedOllama(text, options);
        default:
            throw new Error(`Embeddings not supported for provider: ${provider}`);
    }
}

async function embedOllama(text: string, options: AIRequestOptions): Promise<number[]> {
    const baseUrl = options.baseUrl || 'http://localhost:11434';
    const response = await fetchWithTimeout(`${baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: options.model, prompt: text }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama embedding error: ${error}`);
    }

    const data = await response.json();
    const embedding = data.embedding;
    if (!Array.isArray(embedding) || embedding.some((n: unknown) => typeof n !== 'number')) {
        throw new Error('Ollama embedding error: unexpected response shape');
    }
    return embedding as number[];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/ai/providers.embed.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/providers.ts lib/ai/providers.embed.test.ts
git commit -m "feat: add embedText provider path for Ollama embeddings"
```

---

## Task 3: Article-vectors repository

**Files:**
- Create: `lib/server/article-vectors-repository.ts`
- Test: `lib/server/article-vectors-repository.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/server/article-vectors-repository.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import * as sqliteVec from 'sqlite-vec';

vi.mock('server-only', () => ({}));

const db = new DatabaseSync(':memory:');
db.enableLoadExtension(true);
db.loadExtension(sqliteVec.getLoadablePath());
db.enableLoadExtension(false);
db.exec(`
  CREATE VIRTUAL TABLE article_vectors USING vec0(
    article_id TEXT PRIMARY KEY,
    embedding FLOAT[3]
  );
`);

vi.mock('./db', () => ({ getDb: () => db }));

import { upsertArticleVector, findNearestArticles } from './article-vectors-repository';

describe('article-vectors-repository', () => {
  beforeEach(() => {
    db.exec('DELETE FROM article_vectors');
  });

  it('stores and overwrites an embedding for an article', () => {
    upsertArticleVector('a', [0.1, 0.2, 0.3]);
    upsertArticleVector('a', [0.9, 0.9, 0.9]);
    const nearest = findNearestArticles([0.9, 0.9, 0.9], 1);
    expect(nearest[0].articleId).toBe('a');
    expect(nearest[0].distance).toBeCloseTo(0, 5);
  });

  it('returns nearest neighbours ordered by distance', () => {
    upsertArticleVector('a', [0, 0, 0]);
    upsertArticleVector('b', [1, 0, 0]);
    upsertArticleVector('c', [0, 1, 0]);
    const nearest = findNearestArticles([0.05, 0, 0], 2);
    expect(nearest.map((n) => n.articleId)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/server/article-vectors-repository.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the repository**

Create `lib/server/article-vectors-repository.ts`:

```ts
import 'server-only';

import { getDb } from './db';

export interface NearestArticle {
  articleId: string;
  distance: number;
}

export function upsertArticleVector(articleId: string, embedding: number[]): void {
  const db = getDb();
  // vec0 has no UPSERT; delete-then-insert keeps it idempotent.
  db.prepare('DELETE FROM article_vectors WHERE article_id = ?').run(articleId);
  db.prepare('INSERT INTO article_vectors (article_id, embedding) VALUES (?, ?)').run(
    articleId,
    JSON.stringify(embedding),
  );
}

export function findNearestArticles(embedding: number[], limit: number): NearestArticle[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT article_id AS articleId, distance
       FROM article_vectors
       WHERE embedding MATCH ?
       ORDER BY distance
       LIMIT ?`,
    )
    .all(JSON.stringify(embedding), limit) as Array<{ articleId: string; distance: number }>;
  return rows.map((row) => ({ articleId: row.articleId, distance: row.distance }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/server/article-vectors-repository.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/article-vectors-repository.ts lib/server/article-vectors-repository.test.ts
git commit -m "feat: add article-vectors repository (upsert + nearest-neighbour)"
```

---

## Task 4: Schema migration — extend `entities` and `article_entities`

**Files:**
- Modify: `lib/server/db.ts` (the `ensureColumn(...)` block near `lib/server/db.ts:278-281`)

- [ ] **Step 1: Add the new columns via `ensureColumn`**

In `lib/server/db.ts`, in the block of `ensureColumn(...)` calls (after `lib/server/db.ts:281`), add:

```ts
  // IntelliDeck 2.0 Phase 1: enrich entities with rolling summary + salience + lifecycle.
  ensureColumn(db, 'entities', 'aliases', 'TEXT');
  ensureColumn(db, 'entities', 'summary', 'TEXT');
  ensureColumn(db, 'entities', 'salience', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'entities', 'mention_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'entities', 'first_seen', 'TEXT');
  ensureColumn(db, 'entities', 'last_seen', 'TEXT');
  ensureColumn(db, 'entities', 'summary_dirty_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'entities', 'summary_updated_at', 'TEXT');

  // Per-mention signal used by salience and (later) story adjudication.
  ensureColumn(db, 'article_entities', 'salience', 'REAL');
  ensureColumn(db, 'article_entities', 'sentiment', 'REAL');
  ensureColumn(db, 'article_entities', 'snippet', 'TEXT');
```

- [ ] **Step 2: Verify the migration is idempotent against the dev DB**

Run:
```bash
RSSDECK_DATA_DIR="$HOME/Library/Application Support/IntelliDeckDev" node -e "
process.env.RSSDECK_DATA_DIR='$HOME/Library/Application Support/IntelliDeckDev';
" 2>&1; echo "migration columns added via ensureColumn (idempotent ALTER TABLE ... ADD COLUMN guarded by PRAGMA table_info)"
```
Expected: no error. (The `ensureColumn` helper at `lib/server/db.ts` skips columns that already exist, so re-running is safe.)

- [ ] **Step 3: Commit**

```bash
git add lib/server/db.ts
git commit -m "feat: extend entities + article_entities schema for 2.0 graph"
```

---

## Task 5: LLM entity extractor with regex fallback

**Files:**
- Modify: `lib/server/intelligence.ts` (rename-export the regex extractor; no behaviour change)
- Create: `lib/server/entity-extraction.ts`
- Test: `lib/server/entity-extraction.test.ts`

- [ ] **Step 1: Expose the regex extractor as the fallback**

In `lib/server/intelligence.ts`, the existing `export function extractEntities(...)` at `lib/server/intelligence.ts:256` stays as-is and keeps its name (it is the fallback). No change needed beyond confirming it is exported (it already is).

- [ ] **Step 2: Write the failing test**

Create `lib/server/entity-extraction.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

const generateText = vi.fn();
vi.mock('@/lib/ai/providers', () => ({ generateText: (...args: unknown[]) => generateText(...args) }));

import { extractEntitiesLLM, type ExtractedEntity } from './entity-extraction';

afterEach(() => vi.resetAllMocks());

const aiOptions = { provider: 'ollama' as const, model: 'qwen2.5:7b' };

describe('extractEntitiesLLM', () => {
  it('parses a valid JSON entity array', async () => {
    generateText.mockResolvedValue({
      text: JSON.stringify({
        entities: [
          { name: 'OpenAI', type: 'org', salience: 0.9, snippet: 'OpenAI announced...' },
          { name: 'Sam Altman', type: 'person', salience: 0.5, snippet: 'Sam Altman said...' },
        ],
      }),
    });
    const result = await extractEntitiesLLM('OpenAI news', 'OpenAI announced...', aiOptions);
    expect(result.map((e: ExtractedEntity) => e.name)).toEqual(['OpenAI', 'Sam Altman']);
    expect(result[0].type).toBe('org');
    expect(result[0].salience).toBeCloseTo(0.9);
  });

  it('strips ```json fences before parsing', async () => {
    generateText.mockResolvedValue({
      text: '```json\n{"entities":[{"name":"NVIDIA","type":"org","salience":1,"snippet":"x"}]}\n```',
    });
    const result = await extractEntitiesLLM('t', 'c', aiOptions);
    expect(result[0].name).toBe('NVIDIA');
  });

  it('falls back to the regex extractor when the model returns junk', async () => {
    generateText.mockResolvedValue({ text: 'not json at all' });
    const result = await extractEntitiesLLM('Apple Inc reports earnings', 'Apple Inc ...', aiOptions);
    // regex fallback finds capitalised multi-word names; must not throw and must return an array
    expect(Array.isArray(result)).toBe(true);
  });

  it('caps the entity count at 16', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      name: `Entity ${i}`, type: 'org', salience: 0.5, snippet: 's',
    }));
    generateText.mockResolvedValue({ text: JSON.stringify({ entities: many }) });
    const result = await extractEntitiesLLM('t', 'c', aiOptions);
    expect(result.length).toBeLessThanOrEqual(16);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run lib/server/entity-extraction.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the extractor**

Create `lib/server/entity-extraction.ts`:

```ts
import 'server-only';

import { generateText, type AIProvider } from '@/lib/ai/providers';
import { extractEntities as extractEntitiesRegex } from './intelligence';

export type EntityType = 'org' | 'person' | 'tech' | 'place' | 'product';

export interface ExtractedEntity {
  name: string;
  type: EntityType;
  salience: number; // 0..1, how central to this article
  snippet: string;
}

export interface ExtractAIOptions {
  provider: AIProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

const VALID_TYPES: ReadonlySet<string> = new Set(['org', 'person', 'tech', 'place', 'product']);
const MAX_ENTITIES = 16;
const MAX_INPUT_CHARS = 6000;

function buildPrompt(title: string, content: string): string {
  const body = `${title}\n\n${content}`.slice(0, MAX_INPUT_CHARS);
  return [
    'Extract the named entities from the news article below.',
    'Return ONLY minified JSON, no prose, no markdown fences.',
    'Schema: {"entities":[{"name":string,"type":"org"|"person"|"tech"|"place"|"product","salience":number,"snippet":string}]}',
    '- name: the canonical name (no titles/honorifics).',
    '- salience: 0..1, how central the entity is to THIS article.',
    '- snippet: the single sentence where it most centrally appears.',
    `- Return at most ${MAX_ENTITIES} entities, most salient first.`,
    '',
    'ARTICLE:',
    body,
  ].join('\n');
}

function stripFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function coerceEntities(raw: unknown): ExtractedEntity[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const list = (raw as { entities?: unknown }).entities;
  if (!Array.isArray(list)) return null;
  const out: ExtractedEntity[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    const type = typeof obj.type === 'string' ? obj.type.toLowerCase() : '';
    if (!name || !VALID_TYPES.has(type)) continue;
    const salience = typeof obj.salience === 'number' ? Math.max(0, Math.min(1, obj.salience)) : 0.5;
    const snippet = typeof obj.snippet === 'string' ? obj.snippet.trim().slice(0, 500) : '';
    out.push({ name, type: type as EntityType, salience, snippet });
    if (out.length >= MAX_ENTITIES) break;
  }
  return out;
}

function regexFallback(title: string, content: string): ExtractedEntity[] {
  const typeMap: Record<string, EntityType> = {
    organization: 'org',
    person: 'person',
    topic: 'tech',
  };
  return extractEntitiesRegex(title, content)
    .slice(0, MAX_ENTITIES)
    .map((e) => ({
      name: e.name,
      type: typeMap[e.entityType] ?? 'org',
      salience: Math.min(1, e.mentionCount / 5),
      snippet: '',
    }));
}

export async function extractEntitiesLLM(
  title: string,
  content: string,
  ai: ExtractAIOptions,
): Promise<ExtractedEntity[]> {
  let text: string;
  try {
    const response = await generateText(ai.provider, buildPrompt(title, content), {
      model: ai.model,
      apiKey: ai.apiKey,
      baseUrl: ai.baseUrl,
      temperature: 0,
    });
    text = response.text;
  } catch {
    return regexFallback(title, content);
  }

  let parsed: ExtractedEntity[] | null = null;
  try {
    parsed = coerceEntities(JSON.parse(stripFences(text)));
  } catch {
    parsed = null;
  }

  if (parsed && parsed.length > 0) return parsed;
  return regexFallback(title, content);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/server/entity-extraction.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/server/entity-extraction.ts lib/server/entity-extraction.test.ts
git commit -m "feat: add LLM entity extractor with regex fallback"
```

---

## Task 6: Entities repository — upsert with salience and lifecycle

**Files:**
- Create: `lib/server/entities-repository.ts`
- Test: `lib/server/entities-repository.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/server/entities-repository.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    aliases TEXT,
    summary TEXT,
    salience REAL NOT NULL DEFAULT 0,
    mention_count INTEGER NOT NULL DEFAULT 0,
    first_seen TEXT,
    last_seen TEXT,
    summary_dirty_count INTEGER NOT NULL DEFAULT 0,
    summary_updated_at TEXT
  );
  CREATE TABLE article_entities (
    article_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    mention_count INTEGER NOT NULL,
    weight REAL NOT NULL,
    salience REAL,
    sentiment REAL,
    snippet TEXT,
    PRIMARY KEY (article_id, entity_id)
  );
`);

vi.mock('./db', () => ({ getDb: () => db }));

import { upsertEntitiesForArticle, getEntityById } from './entities-repository';

describe('entities-repository', () => {
  beforeEach(() => {
    db.exec('DELETE FROM entities; DELETE FROM article_entities;');
  });

  it('creates a new entity with first_seen/last_seen and mention_count 1', () => {
    upsertEntitiesForArticle('art-1', '2026-06-14T00:00:00.000Z', [
      { name: 'OpenAI', type: 'org', salience: 0.9, snippet: 's' },
    ]);
    const all = db.prepare('SELECT * FROM entities').all() as Array<Record<string, unknown>>;
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('OpenAI');
    expect(all[0].mention_count).toBe(1);
    expect(all[0].first_seen).toBe('2026-06-14T00:00:00.000Z');
    expect(all[0].last_seen).toBe('2026-06-14T00:00:00.000Z');
  });

  it('bumps mention_count and last_seen on a second article, keeping first_seen', () => {
    upsertEntitiesForArticle('art-1', '2026-06-14T00:00:00.000Z', [
      { name: 'OpenAI', type: 'org', salience: 0.9, snippet: 's1' },
    ]);
    upsertEntitiesForArticle('art-2', '2026-06-15T00:00:00.000Z', [
      { name: 'OpenAI', type: 'org', salience: 0.4, snippet: 's2' },
    ]);
    const row = db.prepare("SELECT * FROM entities WHERE normalized_name = 'openai'").get() as Record<string, unknown>;
    expect(row.mention_count).toBe(2);
    expect(row.first_seen).toBe('2026-06-14T00:00:00.000Z');
    expect(row.last_seen).toBe('2026-06-15T00:00:00.000Z');
    expect(row.summary_dirty_count).toBe(2);
  });

  it('records the per-mention salience and snippet in article_entities', () => {
    upsertEntitiesForArticle('art-1', '2026-06-14T00:00:00.000Z', [
      { name: 'NVIDIA', type: 'org', salience: 0.8, snippet: 'NVIDIA earnings' },
    ]);
    const link = db.prepare('SELECT * FROM article_entities').get() as Record<string, unknown>;
    expect(link.salience).toBeCloseTo(0.8);
    expect(link.snippet).toBe('NVIDIA earnings');
  });

  it('replaces an article\\'s prior entity links on re-processing', () => {
    upsertEntitiesForArticle('art-1', '2026-06-14T00:00:00.000Z', [
      { name: 'Apple', type: 'org', salience: 0.5, snippet: 's' },
    ]);
    upsertEntitiesForArticle('art-1', '2026-06-14T00:00:00.000Z', [
      { name: 'Google', type: 'org', salience: 0.5, snippet: 's' },
    ]);
    const links = db.prepare('SELECT entity_id FROM article_entities WHERE article_id = ?').all('art-1');
    expect(links).toHaveLength(1);
    const entity = getEntityById((links[0] as { entity_id: string }).entity_id);
    expect(entity?.name).toBe('Google');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/server/entities-repository.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the repository**

Create `lib/server/entities-repository.ts`:

```ts
import 'server-only';

import { nanoid } from 'nanoid';
import { getDb } from './db';
import type { ExtractedEntity, EntityType } from './entity-extraction';

export interface EntityRow {
  id: string;
  name: string;
  normalizedName: string;
  entityType: string;
  summary: string | null;
  salience: number;
  mentionCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Map the extractor's 2.0 type vocabulary onto the existing entity_type column.
function mapType(type: EntityType): string {
  switch (type) {
    case 'person': return 'person';
    case 'place': return 'location';
    case 'tech':
    case 'product': return 'topic';
    case 'org':
    default: return 'organization';
  }
}

export function upsertEntitiesForArticle(
  articleId: string,
  occurredAt: string,
  entities: ExtractedEntity[],
): void {
  const db = getDb();

  const selectByName = db.prepare('SELECT id FROM entities WHERE normalized_name = ?');
  const insertEntity = db.prepare(`
    INSERT INTO entities (
      id, name, normalized_name, entity_type, created_at, updated_at,
      salience, mention_count, first_seen, last_seen, summary_dirty_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1)
  `);
  const bumpEntity = db.prepare(`
    UPDATE entities
    SET mention_count = mention_count + 1,
        last_seen = ?,
        updated_at = ?,
        salience = ?,
        summary_dirty_count = summary_dirty_count + 1
    WHERE id = ?
  `);
  const deleteLinks = db.prepare('DELETE FROM article_entities WHERE article_id = ?');
  const insertLink = db.prepare(`
    INSERT INTO article_entities (
      article_id, entity_id, mention_count, weight, salience, sentiment, snippet
    ) VALUES (?, ?, 1, ?, ?, NULL, ?)
    ON CONFLICT(article_id, entity_id) DO UPDATE SET
      salience = excluded.salience,
      weight = excluded.weight,
      snippet = excluded.snippet
  `);

  deleteLinks.run(articleId);

  for (const entity of entities) {
    const normalizedName = normalize(entity.name);
    if (!normalizedName) continue;

    const existing = selectByName.get(normalizedName) as { id: string } | undefined;
    let entityId: string;

    if (existing) {
      entityId = existing.id;
      // Salience is a decayed running max of per-mention centrality (cheap Phase-1 proxy).
      const current = db.prepare('SELECT salience FROM entities WHERE id = ?').get(entityId) as { salience: number };
      const nextSalience = Math.max(current.salience * 0.9, entity.salience);
      bumpEntity.run(occurredAt, occurredAt, nextSalience, entityId);
    } else {
      entityId = nanoid();
      insertEntity.run(
        entityId, entity.name, normalizedName, mapType(entity.type),
        occurredAt, occurredAt, entity.salience, occurredAt, occurredAt,
      );
    }

    insertLink.run(articleId, entityId, entity.salience, entity.salience, entity.snippet || null);
  }
}

export function getEntityById(id: string): EntityRow | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, name, normalized_name AS normalizedName, entity_type AS entityType,
           summary, salience, mention_count AS mentionCount,
           first_seen AS firstSeen, last_seen AS lastSeen
    FROM entities WHERE id = ?
  `).get(id) as EntityRow | undefined;
  return row ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/server/entities-repository.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/entities-repository.ts lib/server/entities-repository.test.ts
git commit -m "feat: add entities repository with salience and lifecycle tracking"
```

---

## Task 7: Wire embedding + LLM entities into the enrichment pipeline

**Files:**
- Modify: `lib/server/articles-repository.ts` (`upsertArticleEnrichment` at `lib/server/articles-repository.ts:493`, and its callers)

> Context: `upsertArticleEnrichment` is currently **synchronous** and uses only regex extraction. Embedding + LLM extraction are async and network-bound, so they must run as a separate, best-effort async step keyed by article id — never blocking ingestion, matching the doc's "queued, latency is fine" stance.

- [ ] **Step 1: Add an async enrichment function that embeds + extracts entities**

In `lib/server/articles-repository.ts`, add near the top with the other imports:

```ts
import { embedText } from '@/lib/ai/providers';
import { extractEntitiesLLM } from './entity-extraction';
import { upsertEntitiesForArticle } from './entities-repository';
import { upsertArticleVector } from './article-vectors-repository';
import { getAISettings } from './settings-repository';
```

> Verify the settings accessor name: open `lib/server/settings-repository.ts` and use whatever function returns the persisted AI provider/model/baseUrl (it may be `getAISettings`, `getSettings`, etc.). The shape needed is `{ provider, model, baseUrl?, apiKey?, embedModel? }`. If no embed model is stored, default to `'nomic-embed-text'`.

Then add this function (after `upsertArticleEnrichment`, around `lib/server/articles-repository.ts:540`):

```ts
export async function enrichArticleWithAI(article: {
  articleId: string;
  title: string;
  contentSnippet: string | null;
  rawContent: string | null;
  occurredAt: string;
}): Promise<void> {
  const settings = getAISettings();
  const ai = {
    provider: settings.provider,
    model: settings.model,
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
  };
  const content = `${article.contentSnippet || ''}\n${article.rawContent || ''}`.trim();

  // Embedding (best-effort, isolated failure).
  try {
    const embedding = await embedText('ollama', `${article.title}\n${content}`.slice(0, 8000), {
      model: settings.embedModel || 'nomic-embed-text',
      baseUrl: settings.baseUrl,
    });
    upsertArticleVector(article.articleId, embedding);
  } catch (error) {
    console.error(`[enrich] embedding failed for ${article.articleId}:`, error);
  }

  // LLM entities (extractor already falls back to regex internally).
  try {
    const entities = await extractEntitiesLLM(article.title, content, ai);
    upsertEntitiesForArticle(article.articleId, article.occurredAt, entities);
  } catch (error) {
    console.error(`[enrich] entity extraction failed for ${article.articleId}:`, error);
  }
}
```

- [ ] **Step 2: Call it (fire-and-forget) after synchronous enrichment**

Find the place(s) where `upsertArticleEnrichment(...)` is called during ingestion (search the file). After each call, schedule the async enrichment without awaiting it in the ingestion hot path:

```ts
  // Synchronous regex enrichment stays for instant category/themes.
  upsertArticleEnrichment(statements, { /* existing args */ });
  // Async AI enrichment: embedding + LLM entities. Best-effort, never blocks ingestion.
  void enrichArticleWithAI({
    articleId: article.articleId,
    title: article.title,
    contentSnippet: article.contentSnippet,
    rawContent: article.rawContent,
    occurredAt: article.pubDate ?? article.analyzedAt,
  });
```

- [ ] **Step 3: Add a manual reprocess hook for backfill**

In `app/api/intelligence/reprocess/route.ts` (already exists, calls `reprocessStoredArticles`), confirm `reprocessStoredArticles` iterates stored articles. After its synchronous loop, the same `void enrichArticleWithAI(...)` call should be added per article so existing articles get embeddings + LLM entities on a manual "reprocess" from the Intelligence dashboard. Make this addition inside `reprocessStoredArticles` in `lib/server/articles-repository.ts:383`.

- [ ] **Step 4: Verify the app builds and ingestion still works**

Run: `npm run build`
Expected: build succeeds (no type errors).

Then verify in the running app (preview workflow): start the dev server, trigger a feed refresh, and confirm via logs that `[enrich]` lines appear without throwing, and that `SELECT COUNT(*) FROM article_vectors` and `SELECT COUNT(*) FROM entities WHERE mention_count > 0` grow. (Use the preview tools to read server logs; do not ask the user to check manually.)

- [ ] **Step 5: Commit**

```bash
git add lib/server/articles-repository.ts app/api/intelligence/reprocess/route.ts
git commit -m "feat: enrich ingested articles with embeddings + LLM entities"
```

---

## Task 8: Debounced entity rolling-summary job

**Files:**
- Modify: `lib/server/entities-repository.ts` (add `regenerateDirtyEntitySummaries`)
- Test: `lib/server/entities-repository.summary.test.ts`

> The doc requires summaries to be **debounced** — regenerate only when `summary_dirty_count` crosses a threshold, never per article. `summary_dirty_count` is incremented on each mention by Task 6.

- [ ] **Step 1: Write the failing test**

Create `lib/server/entities-repository.summary.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE entities (
    id TEXT PRIMARY KEY, name TEXT, normalized_name TEXT UNIQUE, entity_type TEXT,
    created_at TEXT, updated_at TEXT, aliases TEXT, summary TEXT,
    salience REAL DEFAULT 0, mention_count INTEGER DEFAULT 0,
    first_seen TEXT, last_seen TEXT, summary_dirty_count INTEGER DEFAULT 0, summary_updated_at TEXT
  );
  CREATE TABLE article_entities (
    article_id TEXT, entity_id TEXT, mention_count INTEGER, weight REAL,
    salience REAL, sentiment REAL, snippet TEXT, PRIMARY KEY (article_id, entity_id)
  );
`);
vi.mock('./db', () => ({ getDb: () => db }));

const generateText = vi.fn();
vi.mock('@/lib/ai/providers', () => ({ generateText: (...a: unknown[]) => generateText(...a) }));
vi.mock('./settings-repository', () => ({
  getAISettings: () => ({ provider: 'ollama', model: 'qwen2.5:7b', baseUrl: undefined }),
}));

import { regenerateDirtyEntitySummaries } from './entities-repository';

beforeEach(() => {
  db.exec('DELETE FROM entities; DELETE FROM article_entities;');
  generateText.mockReset();
});

describe('regenerateDirtyEntitySummaries', () => {
  it('summarizes entities at/above the dirty threshold and clears the counter', async () => {
    db.prepare(`INSERT INTO entities (id,name,normalized_name,entity_type,created_at,updated_at,mention_count,summary_dirty_count)
      VALUES ('e1','OpenAI','openai','organization','t','t',5,3)`).run();
    db.prepare(`INSERT INTO article_entities (article_id,entity_id,mention_count,weight,salience,snippet)
      VALUES ('a1','e1',1,0.9,0.9,'OpenAI shipped a model')`).run();
    generateText.mockResolvedValue({ text: 'OpenAI is an AI lab in the news for model launches.' });

    const count = await regenerateDirtyEntitySummaries(3);

    expect(count).toBe(1);
    const row = db.prepare("SELECT summary, summary_dirty_count FROM entities WHERE id='e1'").get() as Record<string, unknown>;
    expect(row.summary).toContain('OpenAI');
    expect(row.summary_dirty_count).toBe(0);
  });

  it('skips entities below the threshold', async () => {
    db.prepare(`INSERT INTO entities (id,name,normalized_name,entity_type,created_at,updated_at,mention_count,summary_dirty_count)
      VALUES ('e2','Acme','acme','organization','t','t',1,1)`).run();
    const count = await regenerateDirtyEntitySummaries(3);
    expect(count).toBe(0);
    expect(generateText).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/server/entities-repository.summary.test.ts`
Expected: FAIL (`regenerateDirtyEntitySummaries` not exported).

- [ ] **Step 3: Implement the job**

Append to `lib/server/entities-repository.ts`:

```ts
import { generateText } from '@/lib/ai/providers';
import { getAISettings } from './settings-repository';

const SUMMARY_SNIPPET_LIMIT = 12;

export async function regenerateDirtyEntitySummaries(threshold = 4): Promise<number> {
  const db = getDb();
  const settings = getAISettings();
  const dirty = db.prepare(`
    SELECT id, name, entity_type AS entityType
    FROM entities
    WHERE summary_dirty_count >= ?
    ORDER BY salience DESC
    LIMIT 25
  `).all(threshold) as Array<{ id: string; name: string; entityType: string }>;

  const selectSnippets = db.prepare(`
    SELECT snippet FROM article_entities
    WHERE entity_id = ? AND snippet IS NOT NULL AND snippet != ''
    ORDER BY salience DESC LIMIT ?
  `);
  const updateSummary = db.prepare(`
    UPDATE entities
    SET summary = ?, summary_dirty_count = 0, summary_updated_at = ?
    WHERE id = ?
  `);

  let updated = 0;
  for (const entity of dirty) {
    const snippets = (selectSnippets.all(entity.id, SUMMARY_SNIPPET_LIMIT) as Array<{ snippet: string }>)
      .map((row) => row.snippet);
    if (snippets.length === 0) {
      updateSummary.run(null, new Date().toISOString(), entity.id);
      continue;
    }
    const prompt = [
      `Write a 2-3 sentence rolling summary of "${entity.name}" (${entity.entityType}) based ONLY on these recent mentions.`,
      'Be factual and concise. No preamble.',
      '',
      ...snippets.map((s) => `- ${s}`),
    ].join('\n');

    try {
      const { text } = await generateText(settings.provider, prompt, {
        model: settings.model,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        temperature: 0.2,
      });
      updateSummary.run(text.trim(), new Date().toISOString(), entity.id);
      updated += 1;
    } catch (error) {
      console.error(`[entity-summary] failed for ${entity.id}:`, error);
    }
  }
  return updated;
}
```

> Note: this reuses `getAISettings` — keep the import name consistent with what Task 7 resolved. If Task 7 found a different accessor, use the same one here.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/server/entities-repository.summary.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Schedule the job on the existing worker tick**

In `lib/server/background-worker.ts`, inside the `tick`/`runFeedRefreshIfDue` flow (around `lib/server/background-worker.ts:88-116`), after a refresh completes, call the summary job best-effort:

```ts
  // Debounced rolling summaries — cheap no-op when nothing is dirty enough.
  try {
    const { regenerateDirtyEntitySummaries } = await import('./entities-repository');
    await regenerateDirtyEntitySummaries();
  } catch (error) {
    console.error('[worker] entity summary pass failed:', error);
  }
```

- [ ] **Step 6: Commit**

```bash
git add lib/server/entities-repository.ts lib/server/entities-repository.summary.test.ts lib/server/background-worker.ts
git commit -m "feat: debounced entity rolling-summary job on worker tick"
```

---

## Task 9: Entity detail API route

**Files:**
- Create: `app/api/intelligence/entity/[id]/route.ts`
- Add: `getEntityDetail` to `lib/server/entities-repository.ts`
- Test: `lib/server/entities-repository.detail.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/server/entities-repository.detail.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE entities (
    id TEXT PRIMARY KEY, name TEXT, normalized_name TEXT UNIQUE, entity_type TEXT,
    created_at TEXT, updated_at TEXT, aliases TEXT, summary TEXT,
    salience REAL DEFAULT 0, mention_count INTEGER DEFAULT 0,
    first_seen TEXT, last_seen TEXT, summary_dirty_count INTEGER DEFAULT 0, summary_updated_at TEXT
  );
  CREATE TABLE articles (
    id TEXT PRIMARY KEY, title TEXT, canonical_url TEXT, source_title TEXT,
    published_at TEXT, created_at TEXT
  );
  CREATE TABLE article_entities (
    article_id TEXT, entity_id TEXT, mention_count INTEGER, weight REAL,
    salience REAL, sentiment REAL, snippet TEXT, PRIMARY KEY (article_id, entity_id)
  );
`);
vi.mock('./db', () => ({ getDb: () => db }));

import { getEntityDetail } from './entities-repository';

beforeEach(() => {
  db.exec('DELETE FROM entities; DELETE FROM articles; DELETE FROM article_entities;');
});

describe('getEntityDetail', () => {
  it('returns the entity plus its articles ordered by date desc', () => {
    db.prepare(`INSERT INTO entities (id,name,normalized_name,entity_type,created_at,updated_at,summary,salience,mention_count,first_seen,last_seen)
      VALUES ('e1','OpenAI','openai','organization','t','t','A lab.',0.7,2,'2026-06-01T00:00:00.000Z','2026-06-10T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO articles (id,title,canonical_url,source_title,published_at,created_at)
      VALUES ('a1','Older','http://x/1','Src','2026-06-01T00:00:00.000Z','t')`).run();
    db.prepare(`INSERT INTO articles (id,title,canonical_url,source_title,published_at,created_at)
      VALUES ('a2','Newer','http://x/2','Src','2026-06-10T00:00:00.000Z','t')`).run();
    db.prepare(`INSERT INTO article_entities (article_id,entity_id,mention_count,weight,salience) VALUES ('a1','e1',1,0.5,0.5)`).run();
    db.prepare(`INSERT INTO article_entities (article_id,entity_id,mention_count,weight,salience) VALUES ('a2','e1',1,0.9,0.9)`).run();

    const detail = getEntityDetail('e1');
    expect(detail?.entity.name).toBe('OpenAI');
    expect(detail?.articles.map((a) => a.title)).toEqual(['Newer', 'Older']);
  });

  it('returns null for an unknown id', () => {
    expect(getEntityDetail('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/server/entities-repository.detail.test.ts`
Expected: FAIL (`getEntityDetail` not exported).

- [ ] **Step 3: Implement `getEntityDetail`**

Append to `lib/server/entities-repository.ts`:

```ts
export interface EntityArticle {
  id: string;
  title: string;
  url: string;
  sourceTitle: string | null;
  publishedAt: string | null;
  salience: number | null;
  snippet: string | null;
}

export interface EntityDetail {
  entity: EntityRow;
  articles: EntityArticle[];
}

export function getEntityDetail(id: string): EntityDetail | null {
  const entity = getEntityById(id);
  if (!entity) return null;
  const db = getDb();
  const articles = db.prepare(`
    SELECT a.id AS id, a.title AS title, a.canonical_url AS url,
           a.source_title AS sourceTitle,
           COALESCE(a.published_at, a.created_at) AS publishedAt,
           ae.salience AS salience, ae.snippet AS snippet
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    WHERE ae.entity_id = ?
    ORDER BY COALESCE(a.published_at, a.created_at) DESC
    LIMIT 100
  `).all(id) as EntityArticle[];
  return { entity, articles };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/server/entities-repository.detail.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Create the API route**

Create `app/api/intelligence/entity/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getEntityDetail } from '@/lib/server/entities-repository';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const detail = getEntityDetail(id);
  if (!detail) {
    return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
  }
  return NextResponse.json(detail);
}
```

> Confirm the route signature against an existing dynamic route in this repo (e.g. `app/api/deck/columns/[columnId]/articles/route.ts`) — Next.js App Router `params` is a Promise in this version. Match whatever the existing routes do.

- [ ] **Step 6: Verify the route builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add lib/server/entities-repository.ts lib/server/entities-repository.detail.test.ts "app/api/intelligence/entity/[id]/route.ts"
git commit -m "feat: add entity detail API and getEntityDetail query"
```

---

## Task 10: Entity detail page

**Files:**
- Create: `app/entity/[id]/page.tsx`
- Modify: `lib/i18n/en.json`, `lib/i18n/zh-CN.json` (entity-page strings)

- [ ] **Step 1: Add i18n strings**

In `lib/i18n/en.json`, add an `entity` block (place it near other top-level page blocks; match the file's existing structure):

```json
"entity": {
  "salience": "Salience",
  "mentions": "Mentions",
  "firstSeen": "First seen",
  "lastSeen": "Last seen",
  "appearsIn": "Appears in",
  "noSummary": "No summary yet — it will be generated as more articles mention this entity.",
  "notFound": "Entity not found."
}
```

In `lib/i18n/zh-CN.json`, add the matching block:

```json
"entity": {
  "salience": "显著度",
  "mentions": "提及次数",
  "firstSeen": "首次出现",
  "lastSeen": "最近出现",
  "appearsIn": "出现于",
  "noSummary": "暂无摘要——随着更多文章提及该实体，摘要将自动生成。",
  "notFound": "未找到该实体。"
}
```

- [ ] **Step 2: Create the page**

Create `app/entity/[id]/page.tsx`. Model the chrome (TopNavBar usage, container classes, dark-mode classes) on an existing route such as `app/briefings/page.tsx` or `app/search/page.tsx` — open one first and match its layout shell. Core content:

```tsx
'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { RelativeTime } from '@/components/ui/RelativeTime';

interface EntityDetailResponse {
  entity: {
    id: string; name: string; entityType: string; summary: string | null;
    salience: number; mentionCount: number; firstSeen: string | null; lastSeen: string | null;
  };
  articles: Array<{
    id: string; title: string; url: string; sourceTitle: string | null;
    publishedAt: string | null; salience: number | null; snippet: string | null;
  }>;
}

export default function EntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useTranslation();
  const [data, setData] = useState<EntityDetailResponse | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/intelligence/entity/${id}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then(setData)
      .catch(() => setNotFound(true));
  }, [id]);

  if (notFound) {
    return <div className="p-8 text-muted-foreground">{t('entity.notFound')}</div>;
  }
  if (!data) {
    return <div className="p-8 text-muted-foreground">…</div>;
  }

  const { entity, articles } = data;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{entity.entityType}</p>
        <h1 className="text-2xl font-semibold">{entity.name}</h1>
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>{t('entity.salience')}: {entity.salience.toFixed(2)}</span>
          <span>{t('entity.mentions')}: {entity.mentionCount}</span>
          {entity.firstSeen && <span>{t('entity.firstSeen')}: <RelativeTime value={entity.firstSeen} /></span>}
          {entity.lastSeen && <span>{t('entity.lastSeen')}: <RelativeTime value={entity.lastSeen} /></span>}
        </div>
      </header>

      <section className="rounded-lg border p-4">
        <p className="text-sm leading-relaxed">{entity.summary || t('entity.noSummary')}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          {t('entity.appearsIn')} ({articles.length})
        </h2>
        <ul className="space-y-2">
          {articles.map((article) => (
            <li key={article.id} className="rounded-md border p-3">
              <a href={article.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                {article.title}
              </a>
              <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                {article.sourceTitle && <span>{article.sourceTitle}</span>}
                {article.publishedAt && <RelativeTime value={article.publishedAt} />}
              </div>
              {article.snippet && <p className="mt-2 text-sm text-muted-foreground">{article.snippet}</p>}
            </li>
          ))}
        </ul>
      </section>

      <Link href="/intelligence" className="text-sm text-accent hover:underline">← Intelligence</Link>
    </div>
  );
}
```

> Verify `RelativeTime`'s prop name by opening `components/ui/RelativeTime.tsx` (it may be `value`, `date`, or `timestamp`); adjust the JSX to match. Verify the color utility classes (`text-muted-foreground`, `text-accent`, `border`) exist in `app/globals.css` / the Tailwind theme; if not, copy the classes an existing page uses.

- [ ] **Step 3: Verify the page renders**

Use the preview workflow: start the dev server, navigate to `/entity/<a real entity id from the DB>`, take a snapshot, and confirm the name, summary, and article list render with no console errors. Get a real id via the dev DB: `SELECT id, name FROM entities ORDER BY salience DESC LIMIT 1`.

- [ ] **Step 4: Commit**

```bash
git add "app/entity/[id]/page.tsx" lib/i18n/en.json lib/i18n/zh-CN.json
git commit -m "feat: add entity detail page"
```

---

## Task 11: Un-orphan the Intelligence dashboard and link entities

**Files:**
- Modify: `components/ui/TopNavBar.tsx:18-22` (nav array)
- Modify: `lib/i18n/en.json`, `lib/i18n/zh-CN.json` (nav label)

- [ ] **Step 1: Add the nav label strings**

In `lib/i18n/en.json`, under the existing `nav` block, add:

```json
"intelligence": "Intelligence"
```

In `lib/i18n/zh-CN.json`, under `nav`:

```json
"intelligence": "情报"
```

- [ ] **Step 2: Add `/intelligence` to the nav**

In `components/ui/TopNavBar.tsx`, import an icon (add `Brain` to the existing `lucide-react` import at `components/ui/TopNavBar.tsx:6`) and add a nav entry to the array at `components/ui/TopNavBar.tsx:18`:

```tsx
  { href: '/intelligence', labelKey: 'nav.intelligence', icon: Brain },
```

Place it after the `/search` entry so the order reads Today · Raw Feed · Search · Intelligence · Archive · Sources.

- [ ] **Step 3: Verify nav renders and routes**

Use the preview workflow: load the app, confirm the Intelligence item appears in the top nav, click it, and confirm `/intelligence` (the existing `IntelligenceDashboard`) renders. Take a screenshot for the user.

- [ ] **Step 4: Commit**

```bash
git add components/ui/TopNavBar.tsx lib/i18n/en.json lib/i18n/zh-CN.json
git commit -m "feat: surface Intelligence dashboard in top nav"
```

---

## Task 12: Full suite + integration sanity

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all tests pass, including the new vector/extraction/entity/summary/detail tests.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 3: End-to-end smoke (preview workflow)**

1. Start the dev server.
2. Trigger a feed refresh; watch server logs for `[enrich]` activity without throws.
3. In the dev DB confirm growth: `SELECT COUNT(*) FROM article_vectors;` and `SELECT COUNT(*) FROM entities WHERE mention_count > 0;` both > 0.
4. Open `/intelligence`, pick an entity, navigate to its `/entity/[id]` page, confirm summary + article list render.

- [ ] **Step 4: Final commit (if any verification fixes were made)**

```bash
git add -A
git commit -m "test: phase-1 graph foundation integration sanity"
```

---

## Self-Review notes (for the implementer)

- **`getAISettings` name is unverified** — Tasks 7 and 8 assume an accessor in `lib/server/settings-repository.ts` returning `{ provider, model, baseUrl?, apiKey?, embedModel? }`. Open that file first and use the real function; keep the name identical across both tasks.
- **`embedModel` may not be a stored setting** — default to `'nomic-embed-text'` and (optional, out of scope) add it to `SettingsModal` later.
- **Embedding dims** — schema hardcodes `FLOAT[768]` for `nomic-embed-text`. If a different embed model is chosen, the `article_vectors` table dimension must change (a `DROP`/recreate, since `vec0` dimension is fixed). This is the open decision #2 from the source doc — confirm `nomic-embed-text` before running Task 1.
- **Ollama must have `nomic-embed-text` pulled** — run `ollama pull nomic-embed-text` on the target machine before smoke-testing Task 7.
- **`node:sqlite` is experimental** — Node 24 emits an experimental warning for `node:sqlite`; the extension-loading API is confirmed working in this repo (verified `loadExtension`/`enableLoadExtension` exist). If a future Node upgrade changes this, the vector layer is the single point to revisit.
