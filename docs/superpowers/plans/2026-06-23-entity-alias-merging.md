# Cross-Language Entity Alias Merging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse EN/CN name variants of the same entity ("Fed"/"Federal Reserve"/"美联储") into one entity row at write time, and backfill existing fragmented rows.

**Architecture:** A curated bilingual alias map (`entity-aliases.ts`) exposes `canonicalizeEntity(name, type)`, applied at the `upsertEntitiesForArticle` chokepoint. A one-time idempotent `mergeAliasedEntities()` repoints existing `article_entities` onto canonical rows and deletes duplicates, run on worker startup.

**Tech Stack:** TypeScript, `node:sqlite`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-23-entity-alias-merging-design.md`

---

## File Structure
- **Create** `lib/server/entity-aliases.ts` — `ENTITY_ALIASES`, `canonicalizeEntity`, `mergeAliasedEntities`.
- **Create** `lib/server/entity-aliases.test.ts` — pure + DB tests.
- **Modify** `lib/server/entities-repository.ts` — apply `canonicalizeEntity` in `upsertEntitiesForArticle`.
- **Modify** `lib/server/background-worker.ts` — run `mergeAliasedEntities()` once on startup.

Note: `entity-aliases.ts` must NOT import from `entities-repository.ts` (that module imports `canonicalizeEntity`, so importing back would create a cycle). It defines its own local `normalize` and entity-type→column map.

---

## Task 1: Alias map + canonicalizeEntity

**Files:**
- Create: `lib/server/entity-aliases.ts`
- Test: `lib/server/entity-aliases.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/server/entity-aliases.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));

// entity-aliases.ts imports ./db (for mergeAliasedEntities), so mock it at load. The
// in-memory schema is used by the backfill tests added in Task 3.
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE entities (id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL, mention_count INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE article_entities (article_id TEXT NOT NULL, entity_id TEXT NOT NULL, PRIMARY KEY(article_id, entity_id));
`);
vi.mock('./db', () => ({ getDb: () => db }));

import { canonicalizeEntity } from './entity-aliases';

describe('canonicalizeEntity', () => {
  it('maps an English alias to the canonical name + type', () => {
    expect(canonicalizeEntity('the Fed', 'org')).toEqual({ name: 'Federal Reserve', type: 'org' });
  });

  it('maps a Chinese alias to the same canonical entity', () => {
    expect(canonicalizeEntity('美联储', 'org')).toEqual({ name: 'Federal Reserve', type: 'org' });
  });

  it('corrects the type from the alias map (White House is an org, not a person)', () => {
    expect(canonicalizeEntity('白宫', 'person')).toEqual({ name: 'White House', type: 'org' });
  });

  it('returns unknown names unchanged', () => {
    expect(canonicalizeEntity('Acme Widgets', 'org')).toEqual({ name: 'Acme Widgets', type: 'org' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run entity-aliases`
Expected: FAIL — module/function not found.

- [ ] **Step 3: Implement the map + canonicalizeEntity**

```typescript
// lib/server/entity-aliases.ts
import 'server-only';

import { getDb } from './db';
import type { EntityType } from './entity-extraction';

interface AliasGroup {
  canonical: string;
  type: EntityType; // 'person' | 'org' only for this curated set
  aliases: string[];
}

// Curated, bilingual (EN + 简体中文). People and organizations only — countries are
// handled by the location path. Extend as the feeds warrant.
export const ENTITY_ALIASES: AliasGroup[] = [
  { canonical: 'Federal Reserve', type: 'org', aliases: ['fed', 'the fed', 'us federal reserve', '美联储', '联准会'] },
  { canonical: 'White House', type: 'org', aliases: ['the white house', '白宫'] },
  { canonical: 'United Nations', type: 'org', aliases: ['un', 'u.n.', '联合国'] },
  { canonical: 'NATO', type: 'org', aliases: ['north atlantic treaty organization', '北约'] },
  { canonical: 'European Union', type: 'org', aliases: ['eu', 'e.u.', '欧盟'] },
  { canonical: 'Apple', type: 'org', aliases: ['apple inc', 'apple inc.', '苹果', '苹果公司'] },
  { canonical: 'Nvidia', type: 'org', aliases: ['nvidia corp', '英伟达'] },
  { canonical: 'TSMC', type: 'org', aliases: ['taiwan semiconductor', '台积电'] },
  { canonical: 'Joe Biden', type: 'person', aliases: ['biden', 'president biden', '拜登', '乔·拜登'] },
  { canonical: 'Donald Trump', type: 'person', aliases: ['trump', 'president trump', '特朗普', '川普'] },
  { canonical: 'Xi Jinping', type: 'person', aliases: ['xi', 'president xi', '习近平', '习'] },
  { canonical: 'Vladimir Putin', type: 'person', aliases: ['putin', '普京'] },
];

function normalize(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

// entity_type column value for the curated types (avoids importing mapType, which would
// create a cycle with entities-repository).
function typeColumn(type: EntityType): string {
  return type === 'person' ? 'person' : 'organization';
}

// normalizedAlias -> canonical group, built once. Includes the canonical name itself.
const REVERSE = new Map<string, AliasGroup>();
for (const group of ENTITY_ALIASES) {
  for (const key of [group.canonical, ...group.aliases]) {
    REVERSE.set(normalize(key), group);
  }
}

/**
 * Map an entity name+type to its canonical form if known, else return unchanged.
 * Also corrects the type from the alias map (e.g. White House -> org).
 */
export function canonicalizeEntity(name: string, type: EntityType): { name: string; type: EntityType } {
  const group = REVERSE.get(normalize(name));
  if (!group) return { name, type };
  return { name: group.canonical, type: group.type };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run entity-aliases`
Expected: PASS (4 tests). Also `npx tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/server/entity-aliases.ts lib/server/entity-aliases.test.ts
git commit -m "feat: curated bilingual entity alias map + canonicalizeEntity"
```

---

## Task 2: Apply canonicalization at upsert

**Files:**
- Modify: `lib/server/entities-repository.ts` (the loop body in `upsertEntitiesForArticle`)
- Test: extend `lib/server/entity-aliases.test.ts` is NOT right — add the integration test to a new `lib/server/entities-repository.alias.test.ts` (entities-repository has no existing unit test and pulls many deps; keep this focused).

- [ ] **Step 1: Write the failing integration test**

```typescript
// lib/server/entities-repository.alias.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE entities (id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    salience REAL NOT NULL DEFAULT 0, mention_count INTEGER NOT NULL DEFAULT 0,
    first_seen TEXT, last_seen TEXT, summary TEXT, summary_dirty_count INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE article_entities (article_id TEXT NOT NULL, entity_id TEXT NOT NULL, mention_count INTEGER NOT NULL,
    weight REAL NOT NULL, salience REAL, sentiment REAL, snippet TEXT, PRIMARY KEY(article_id, entity_id));
`);
vi.mock('./db', () => ({ getDb: () => db }));
vi.mock('./settings-repository', () => ({ getServerAISettings: () => ({ enabled: true }) }));

import { upsertEntitiesForArticle } from './entities-repository';

beforeEach(() => { db.exec('DELETE FROM entities; DELETE FROM article_entities;'); });

describe('upsertEntitiesForArticle canonicalization', () => {
  it('collapses EN and CN variants into one canonical entity row', () => {
    upsertEntitiesForArticle('a1', 't', [{ name: 'the Fed', type: 'org', salience: 0.5, snippet: '' }]);
    upsertEntitiesForArticle('a2', 't', [{ name: '美联储', type: 'org', salience: 0.5, snippet: '' }]);
    const rows = db.prepare("SELECT name, normalized_name, mention_count FROM entities").all() as Array<{ name: string; normalized_name: string; mention_count: number }>;
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('Federal Reserve');
    expect(rows[0].mention_count).toBe(2); // bumped once per article
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run entities-repository.alias`
Expected: FAIL — two separate rows ("the Fed" and "美联储"), length 2.

- [ ] **Step 3: Apply canonicalizeEntity in the loop**

In `lib/server/entities-repository.ts`, add the import near the top:

```typescript
import { canonicalizeEntity } from './entity-aliases';
```

In `upsertEntitiesForArticle`, the loop currently starts:

```typescript
  for (const entity of entities) {
    const normalizedName = normalize(entity.name);
    if (!normalizedName) continue;
```

Replace those lines with:

```typescript
  for (const rawEntity of entities) {
    const canon = canonicalizeEntity(rawEntity.name, rawEntity.type);
    const entity = { ...rawEntity, name: canon.name, type: canon.type };
    const normalizedName = normalize(entity.name);
    if (!normalizedName) continue;
```

The rest of the loop already uses `entity.name`, `mapType(entity.type)`, `entity.salience`, `entity.snippet` — now reading the canonicalized values. No other changes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run entities-repository.alias`
Expected: PASS (1 test). Then `npx tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/server/entities-repository.ts lib/server/entities-repository.alias.test.ts
git commit -m "feat: canonicalize entities at upsert (collapse EN/CN variants)"
```

---

## Task 3: Backfill existing fragmented rows

**Files:**
- Modify: `lib/server/entity-aliases.ts` (add `mergeAliasedEntities`)
- Test: extend `lib/server/entity-aliases.test.ts`

- [ ] **Step 1: Write the failing backfill test**

The in-memory `db` mock + schema were already declared at the top of
`lib/server/entity-aliases.test.ts` in Task 1. Add `mergeAliasedEntities` to the existing
import from `./entity-aliases`, then append this block (the `beforeEach` sweep keeps the
backfill test isolated from any rows other tests insert):

```typescript
describe('mergeAliasedEntities', () => {
  beforeEach(() => { db.exec('DELETE FROM entities; DELETE FROM article_entities;'); });


  it('merges fragmented rows onto one canonical row and repoints links (conflict-safe)', () => {
    db.exec(`
      INSERT INTO entities (id, name, normalized_name, entity_type, mention_count) VALUES
        ('fed','Fed','fed','organization',3),
        ('cn','美联储','美联储','organization',2);
      -- a3 links BOTH rows -> conflict on repoint
      INSERT INTO article_entities (article_id, entity_id) VALUES
        ('a1','fed'), ('a2','cn'), ('a3','fed'), ('a3','cn');
    `);
    const merged = mergeAliasedEntities();
    expect(merged).toBeGreaterThanOrEqual(1);

    const rows = db.prepare("SELECT normalized_name FROM entities WHERE normalized_name IN ('fed','美联储','federal reserve')").all() as Array<{ normalized_name: string }>;
    expect(rows.map((r) => r.normalized_name).sort()).toEqual(['federal reserve']);

    // every surviving link points to one entity id; no orphan rows pointing at deleted 'cn'
    const survivorId = (db.prepare("SELECT id FROM entities WHERE normalized_name='federal reserve'").get() as { id: string }).id;
    const links = db.prepare('SELECT DISTINCT entity_id FROM article_entities').all() as Array<{ entity_id: string }>;
    expect(links).toEqual([{ entity_id: survivorId }]);
    // a3 collapsed from two links to one
    const a3 = db.prepare("SELECT COUNT(*) AS c FROM article_entities WHERE article_id='a3'").get() as { c: number };
    expect(a3.c).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run entity-aliases`
Expected: FAIL — `mergeAliasedEntities` not exported.

- [ ] **Step 3: Implement mergeAliasedEntities**

Append to `lib/server/entity-aliases.ts`:

```typescript
/**
 * One-time, idempotent backfill: merge existing entity rows that match a curated alias
 * group onto a single canonical row, repointing article_entities and deleting the
 * duplicate rows. Scoped to the curated set, so re-running is cheap and finds nothing
 * once converged. Returns the number of duplicate rows merged.
 */
export function mergeAliasedEntities(): number {
  const db = getDb();
  let merged = 0;

  for (const group of ENTITY_ALIASES) {
    const canonNorm = normalize(group.canonical);
    const names = [group.canonical, ...group.aliases].map(normalize);
    const placeholders = names.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT id, normalized_name AS norm, mention_count AS mc FROM entities WHERE normalized_name IN (${placeholders})`)
      .all(...names) as Array<{ id: string; norm: string; mc: number }>;
    if (rows.length <= 1) continue;

    // survivor: the canonical-named row if present, else the highest mention_count row
    const survivor =
      rows.find((r) => r.norm === canonNorm) ??
      rows.reduce((a, b) => (b.mc > a.mc ? b : a));

    try {
      db.exec('BEGIN');
      db.prepare('UPDATE entities SET name = ?, normalized_name = ?, entity_type = ? WHERE id = ?')
        .run(group.canonical, canonNorm, typeColumn(group.type), survivor.id);
      for (const dup of rows) {
        if (dup.id === survivor.id) continue;
        db.prepare('UPDATE OR IGNORE article_entities SET entity_id = ? WHERE entity_id = ?').run(survivor.id, dup.id);
        db.prepare('DELETE FROM article_entities WHERE entity_id = ?').run(dup.id);
        db.prepare('DELETE FROM entities WHERE id = ?').run(dup.id);
        merged += 1;
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      console.error(`[entity-aliases] merge failed for ${group.canonical}:`, err);
    }
  }
  return merged;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run entity-aliases`
Expected: PASS (pure tests + backfill test). Then `npx tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/server/entity-aliases.ts lib/server/entity-aliases.test.ts
git commit -m "feat: mergeAliasedEntities backfill (repoint links, conflict-safe)"
```

---

## Task 4: Run backfill on worker startup + verify

**Files:**
- Modify: `lib/server/background-worker.ts`

- [ ] **Step 1: Run the backfill once at startup**

In `lib/server/background-worker.ts`, find `export function startBackgroundWorker()`. Near the start of that function (before scheduling the tick), add a one-shot, best-effort backfill:

```typescript
  void import('./entity-aliases')
    .then((m) => {
      const merged = m.mergeAliasedEntities();
      if (merged > 0) console.log(`[IntelliDeck worker] Merged ${merged} aliased entity rows.`);
    })
    .catch((err) => console.error('[IntelliDeck worker] entity alias backfill failed:', err));
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Full suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add lib/server/background-worker.ts
git commit -m "feat: run entity alias backfill once on worker startup"
```

---

## Self-review notes
- Spec coverage: alias map + `canonicalizeEntity` with type correction (Task 1); applied at upsert chokepoint (Task 2); idempotent backfill with conflict-safe repoint (Task 3); worker-startup trigger (Task 4). All covered.
- No cycle: `entity-aliases.ts` imports only `./db` and the `EntityType` type from `./entity-extraction`; it does NOT import `entities-repository.ts` (which imports it). Local `normalize` + `typeColumn` avoid that.
- Type consistency: `canonicalizeEntity(name, type): { name, type }`, `mergeAliasedEntities(): number`, `ENTITY_ALIASES: AliasGroup[]` used consistently across tasks.
- `EntityType` import is `import type` (no runtime cycle).
