# LLM-Minimized Pipeline — Design

**Date:** 2026-06-22
**Goal:** Eliminate per-article LLM calls (the throughput bottleneck) by making the
ingestion → clustering → situation-mapping pipeline deterministic, and reserve the
LLM for a small set of high-value, low-frequency synthesis outputs.

## Motivation

The intelligence pipeline currently makes **two LLM calls per ingested article**
(entity extraction + story-assignment adjudication). On a single-slot Ollama host
this saturates the inference slot, so the pipeline falls behind ingestion and
starves interactive/synthesis requests. Measurement showed per-call latency is
dominated by model load/queue-wait, not generation — the fix is to stop making
per-article LLM calls at all.

The user values the **situation mapping** (the SituationBoard: story summaries,
key actors, trajectory, the world-synthesis narrative) and wants LLM involvement
concentrated on **high-quality synthesis** only. Almost every situation-mapping
field can be produced by deterministic computation from data already stored.

## Principle

- **Per-article path: 100% LLM-free.** Embeddings (fast, separate runner) + regex
  tagging + vector math only.
- **Every story** gets baseline mapping fields from cheap computation.
- **LLM is allowed in exactly three places**, all low-frequency: top board-story
  summaries (gated), the world-synthesis narrative, and the daily briefing.

## Part 1 — Deterministic pipeline

### Per-article enrichment (`enrichArticleWithAI`, lib/server/articles-repository.ts)
- **Keep** `embedText` — embeddings are the clustering backbone (nomic, ~0.06s,
  separate runner, not the bottleneck).
- **Keep** the deterministic `classifyCategory` / `extractThemes` /
  `extractLocations` / `extractEntities` regex pass.
- **Remove** `extractEntitiesLLM` — the regex entities already populate
  `article_entities`.
- **Remove** the `createLLMAdjudicator` usage from the assignment call.

Net per-article work: embed + regex tagging + vector math. Zero gemma calls.

### Story clustering (lib/server/story-assignment.ts)
- `assignArticleToStory` uses recency-weighted cosine similarity only; the LLM
  adjudicator is no longer wired into the per-article path.
- Raise `STORY_SIM_THRESHOLD` from 0.78 to **~0.83** to stay merge-safe without the
  LLM veto. Tunable; validate against real data during implementation.
- `createLLMAdjudicator` may be retained (unwired) or removed.

### Deterministic story metadata (new module `lib/server/story-metadata.ts`)
Maintained for **all** stories (including the long tail) on assignment + worker tick:
- **Title:** the highest-salience member article's title, falling back to the
  earliest if salience is unavailable.
- **Actors (long-tail):** frequency-rank `article_entities` aggregated across the
  story's articles → `actors_json`.
- **Trajectory:** computed from `story_articles` cadence — articles in last 24h vs
  prior 24h → escalating / developing / dormant. Pure arithmetic.
- **Extractive one-liner:** representative snippet (nearest the story centroid) used
  as a placeholder summary until/unless an LLM summary exists.

## Part 2 — LLM scope (three places only)

### 1. Top board-story summaries (hybrid, gated to top ~12)
"Top N" means the existing situation-board ranking — the order already produced by
`getSituationBoard` / `getRankedStories` (salience + recency). No new ranking is
introduced.

Reuse the existing narrative-brief generator (lib/server/stories-repository.ts),
which already emits summary + actors + trajectory + stakes in one call. For these
stories, the LLM-produced actors/trajectory **override** the deterministic ones
(best quality where it is shown).
- **Top ~5 (warm):** background-worker tick regenerates only those dirty since last
  summary.
- **Ranks 6–12 (lazy):** generated on first board/detail request, then cached via
  the existing `summary` + `summary_updated_at` + `summary_dirty_count`. Until
  generated, serve deterministic title + extractive one-liner + deterministic
  actors/trajectory as placeholder.
- **Below rank 12:** never get an LLM summary — deterministic fields only.

### 2. World-synthesis narrative (lib/server/world-synthesis.ts)
**Unchanged.** Already one call, 10-minute cache, skip-if-unchanged.

### 3. Daily briefing (lib/server/briefing-synthesis.ts)
**Unchanged.** Once per day; the high-quality report.

## Code changes
- `articles-repository.ts` — remove the two per-article LLM calls from
  `enrichArticleWithAI`.
- `story-assignment.ts` — adjudicator optional/unused; raise threshold.
- **New** `story-metadata.ts` — deterministic actors + trajectory + representative
  title + extractive one-liner.
- `stories-repository.ts` — gate narrative-brief generation to top-N; keep
  deterministic metadata for the rest.
- `background-worker.ts` — schedule deterministic metadata refresh for active
  stories + LLM summary for dirty top-5.
- Board / story-detail API — lazy trigger for ranks 6–12.

## Testing
- **Unit:** deterministic actors (entity aggregation), trajectory buckets,
  extractive one-liner, clustering threshold behavior.
- **Guard test:** mock `generateText` and assert it is **never called** in the
  per-article enrichment path (locks in "no clog").
- Adjust existing story-assignment tests for the threshold / adjudicator change.

## Migration
Keep existing data; new logic applies going forward. Existing LLM summaries remain
valid; stories refresh into the new scheme as they update. No backfill.

## Out of scope
- Adding a Chinese tokenizer/NER (nodejieba): not needed — top board stories get LLM
  actors; the long tail uses the gazetteer + Latin regex.
- Changing the world-synthesis or daily-briefing prompts/logic.
- Host-level Ollama tuning (tracked separately).
