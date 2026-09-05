# Chinese-Aware Deterministic NER — Design

**Date:** 2026-06-22
**Goal:** Extract Chinese person and organization names deterministically (no LLM) so
the situation board's "key actors" are accurate on Chinese-heavy feeds, where the
current capitalization-based regex extractor finds almost nothing.

## Motivation

`extractEntitiesDeterministic` (lib/server/entity-extraction.ts) keys off
capitalization (`[A-Z][a-z]+`), which Chinese text does not have. After the
LLM-minimized refactor, the long tail of stories (everything not in the warm/lazy
LLM-summary set) shows deterministic actors only — so Chinese stories currently show
weak or empty actor lists. Locations are already CJK-aware via the gazetteer; the gap
is **people and organizations**.

## Approach

Add Chinese NER via `@node-rs/jieba` (Rust + N-API, prebuilt binaries, no node-gyp,
ABI-stable across Node/Electron — the app ships with Electron). Use jieba POS tagging
and keep only `nr` (person) and `nt` (organization). Merge the results into the
existing deterministic extractor so all downstream consumers benefit unchanged.

Chosen over: native `nodejieba` (node-gyp + electron-rebuild pain), pure-JS tokenizers
(lower quality), and a gazetteer-only approach (low recall).

## Components

### New: `lib/server/cjk-ner.ts`
Single responsibility — Chinese text → proper-noun entities.

```
export interface CjkEntity { name: string; type: 'person' | 'org'; count: number }
export function extractCjkEntities(text: string): CjkEntity[]
```

- Lazily loads `@node-rs/jieba` as a module-level singleton (dict loaded once),
  wrapped in try/catch. If load/tagging fails, returns `[]` and logs once — the
  deterministic path degrades to Latin-only.
- Cheap guard: if the text contains no CJK char (`/[一-鿿]/`), return `[]`
  without invoking jieba (English-only articles skip it).
- Runs jieba `tag()`; keeps only tokens tagged exactly `nr` (→ person) or `nt`
  (→ org); aggregates duplicate tokens into `count`.

### Modified: `extractEntitiesDeterministic` (lib/server/entity-extraction.ts)
Remains the single deterministic entry point. New behavior: merge (a) existing Latin
regex entities with (b) `extractCjkEntities`, dedup by a lowercased-trimmed name key
(Latin entity wins on collision since it already carries a richer type), sort by
frequency, cap at `MAX_ENTITIES` (16). CJK salience mirrors the Latin path:
`min(1, count / 5)`; `snippet: ''`.

Everything downstream (`upsertEntitiesForArticle` → `buildDeterministicActors` →
board actors) is unchanged.

## Noise control
- Drop tokens shorter than 2 characters.
- Require the token be majority-CJK (more than half its characters in the
  `一-鿿` range), so a Latin token mis-tagged `nr` is discarded (Latin names
  remain the regex path's responsibility).
- A small, extendable blacklist of common false-positive proper nouns (filler such as
  报道/记者/中新网-style tokens), seeded from observed noise.
- Only exact `nr`/`nt` tags survive (no `nrfg`/`nrt`/fuzzy variants).

## Data flow

```
article text
   ├─ extractEntitiesRegex (Latin, existing)        → [{name,type,...}]
   └─ extractCjkEntities (jieba nr/nt, new)          → [{name,type,count}]
        merge + dedup(normalized name) + sort(freq) + cap(16)
   → ExtractedEntity[]  → upsertEntitiesForArticle → entities / article_entities
   → buildDeterministicActors (SUM weight) → situation board actors
```

## Error handling
- jieba module/binary load failure → `extractCjkEntities` returns `[]` (logged once);
  no throw escapes into enrichment. Latin extraction continues.
- jieba `tag()` throwing on a specific input → caught, returns `[]` for that call.

## Testing
- `cjk-ner.test.ts` (real `@node-rs/jieba`): Chinese sentence with a person + an org →
  both returned with correct types; a short or blacklisted token → filtered;
  English-only text → `[]`.
- Extend the `entity-extraction` test: a mixed CN+EN article yields both Chinese
  (jieba) and Latin (regex) entities, deduped, capped at 16.
- Fallback test: when jieba load throws (mock the import to reject), `extractCjkEntities`
  returns `[]` and `extractEntitiesDeterministic` still returns the Latin entities.

## Dependency
Add `@node-rs/jieba` to `package.json` dependencies. N-API prebuilt — no build step.

## Out of scope (deferred)
- Chinese place entities (`ns`) — the location gazetteer already covers places.
- Cross-language entity canonicalization / alias merging (CN "美联储" ↔ EN "Federal
  Reserve") — that is suggestion #5, a separate change.
- The noisy `nz` (other proper noun) tag — excluded to keep actor lists clean.
- Any LLM involvement.
