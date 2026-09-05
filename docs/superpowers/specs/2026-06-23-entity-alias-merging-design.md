# Cross-Language Entity Alias Merging — Design

**Date:** 2026-06-23
**Goal:** Collapse name variants of the same real-world entity — across English and
Chinese — into one entity row, so actor lists, entity summaries, and #1 clustering
corroboration treat "Fed" / "Federal Reserve" / "美联储" as a single actor.

## Motivation

Entities dedup on exact `normalized_name` (lowercase+trim) in `upsertEntitiesForArticle`.
So "Fed", "Federal Reserve", and "美联储" are three separate rows among the ~29k
entities. This fragments: actor ranking (`buildDeterministicActors` sums `article_entities`
weight per entity_id), entity rolling summaries/detail, and the #1 shared-entity
corroboration check — which cannot tell an EN article's "Federal Reserve" matches a CN
article's "美联储", so it fails to corroborate cross-language merges.

## Part 1 — Alias map & application

### New `lib/server/entity-aliases.ts`
Mirrors the existing `LOCATION_ALIAS_MAP` / `LOCATION_SEEDS` pattern in `intelligence.ts`.

- `ENTITY_ALIASES`: curated list of `{ canonical: string; type: EntityType; aliases: string[] }`,
  bilingual (EN + 简体中文), scoped to **people and organizations** (countries remain in
  the location path). Seed ~2–3 dozen high-value entries for the feeds (e.g.
  美联储/Fed/Federal Reserve → org; 拜登/Biden, 习近平/Xi Jinping, 普京/Putin → person;
  联合国/UN, 北约/NATO, 欧盟/EU, 苹果/Apple, 英伟达/Nvidia → org). Extendable.
- A reverse map `normalizedAlias → { canonical, type }`, built once at module load,
  including the canonical name itself mapped to itself.
- `canonicalizeEntity(name, type): { name: string; type: EntityType }` — if the
  normalized name matches a known alias/canonical, return the canonical name **and** its
  type (this also corrects mis-typings, e.g. jieba tagging 白宫/White House as person →
  org); otherwise return the input unchanged.

### Applied in `upsertEntitiesForArticle` (entities-repository.ts)
The single write chokepoint. Before the `normalize()` / `normalized_name` lookup, run
`canonicalizeEntity(entity.name, entity.type)` and use the canonical name + type. All
variants (EN regex output and CN jieba output) collapse into one entity row going
forward, and the canonical type wins.

## Part 2 — One-time backfill

Going-forward canonicalization only fixes new mentions; existing fragmented rows stay
split. `mergeAliasedEntities(): number` merges them. Blast radius is small — only
entities whose `normalized_name` is in the curated map are touched.

For each canonical group:
1. Find existing entity rows whose `normalized_name ∈ {aliases ∪ canonical}`. If none
   exist, skip the group. Otherwise pick a survivor: prefer the row already at the
   canonical `normalized_name`; else the row with the highest `mention_count`. Set the
   survivor's `name` = canonical, `normalized_name` = `normalize(canonical)`,
   `entity_type` = the canonical type. All other rows in the group are duplicates.
2. For each duplicate row `<dup>` (≠ survivor):
   - `UPDATE OR IGNORE article_entities SET entity_id = <survivor> WHERE entity_id = <dup>`
     (`OR IGNORE` skips rows where the article already links the survivor entity);
   - `DELETE FROM article_entities WHERE entity_id = <dup>` (clears the skipped conflicts);
   - `DELETE FROM entities WHERE id = <dup>`.
3. Wrap each group's changes in a transaction. Return the count of duplicate rows merged.

**Triggering:** idempotent — run once on worker startup. Cheap (scoped to the curated
set); re-running finds nothing to merge, so no migration marker is needed.

## Error handling
- `canonicalizeEntity` is pure and total (returns input on no match).
- `mergeAliasedEntities` wraps each group in a transaction and runs inside the worker
  startup path; a failure in one group is logged and does not abort ingestion.

## Testing
- `entity-aliases.test.ts` (pure): `canonicalizeEntity` maps an EN alias → canonical, a
  CN alias → canonical, corrects type, returns unknown names unchanged.
- Upsert integration (in-memory DB): upserting "Fed" then "美联储" yields ONE entity row
  (canonical) with accumulated `mention_count`.
- Backfill (in-memory DB): two fragmented rows + their `article_entities`, including the
  conflict case where one article links both → after `mergeAliasedEntities`, one
  canonical row remains, links repointed, no orphan `article_entities`, correct counts;
  returns the merged-duplicate count.

## Out of scope
- Fuzzy / similarity-based matching (curated exact-alias only).
- LLM-based canonicalization or auto-learning new aliases.
- Countries / locations (handled by the location path).
- Backfilling `entities.mention_count` exactness beyond link repointing (the
  authoritative actor signal is `article_entities`, which is repointed correctly).
