# Clustering Shared-Entity Corroboration — Design

**Date:** 2026-06-23
**Goal:** Reduce false story merges in the uncertain similarity band by requiring a
shared named entity to corroborate a merge, while leaving confident merges untouched.

## Motivation

After the LLM-minimized refactor, story clustering is vector-only: an article attaches
to the best recency-weighted cosine match when the score clears a single threshold
(`STORY_SIM_THRESHOLD = 0.83`), with no LLM adjudicator in the default path. A single
global threshold causes false merges — distinct stories whose embeddings happen to be
similar get joined. The old LLM adjudicator caught these; this restores a deterministic
equivalent using entity overlap, which is now meaningful for Chinese content too
(Chinese NER landed in commit `efd28fe`).

This change only *adds* a guard in the uncertain band; it does not loosen anything.

## Design

### New module: `lib/server/story-corroboration.ts`
Single responsibility — does an article share a named entity with a story?

```
export function articleSharesEntityWithStory(articleId: string, storyId: string): boolean
```

- Loads the article's entity-id set from `article_entities`.
- Loads the story's entity-id set: distinct `entity_id` across the story's member
  articles (`story_articles` ⋈ `article_entities`).
- No-entity fallback: if the **article** has zero entities, return `true` — we cannot
  corroborate, so we do not penalize; the caller falls back to cosine-only.
- Otherwise return whether the two sets intersect (≥1 shared entity).

### Modified: `assignArticleToStory` (lib/server/story-assignment.ts)
Two-tier decision in place of the single-threshold attach:

```
if best && best.score >= STORY_SIM_THRESHOLD:            // 0.83 floor (unchanged)
    corroborated = best.score >= STORY_AUTO_MERGE_THRESHOLD   // 0.88 ceiling (new)
                   || articleSharesEntityWithStory(input.articleId, best.id)
    if corroborated:
        sameStory = true
        if deps: sameStory = adjudicate(...)              // optional LLM, default path passes none
        if sameStory: attachArticleToStory(...); return { storyId: best.id, created: false }
    // not corroborated → fall through
createStory(...); return { storyId, created: true }
```

New constant `STORY_AUTO_MERGE_THRESHOLD = 0.88` (named, tunable) alongside the
existing `STORY_SIM_THRESHOLD = 0.83`. Confident matches (≥0.88) auto-merge exactly as
before; only the 0.83–0.88 band now requires a shared entity.

## Data flow

```
incoming article (entities already upserted before assignment)
  → best recency-weighted cosine candidate
  → score ≥ 0.88 ? merge
  → 0.83 ≤ score < 0.88 ? articleSharesEntityWithStory ? merge : new story
  → score < 0.83 ? new story
```

## Error handling
- Corroboration queries are plain SQLite reads. `articleSharesEntityWithStory` wraps
  its own logic in try/catch and returns `false` on any error, so a failure degrades to
  "not corroborated" → new story (safe, biased against a false merge) rather than
  aborting the whole assignment. The outer best-effort try/catch around
  `assignArticleToStory` in `enrichArticleWithAI` remains as a backstop.

## Testing
- `story-corroboration.test.ts` (in-memory DB): shared entity → `true`; disjoint → `false`;
  article with no entities → `true` (fallback); story with no entities, article has some → `false`.
- Extend `story-assignment.test.ts` (add `article_entities` + `story_articles` to the
  fixture): (a) score ≥ 0.88 auto-merges regardless of entities; (b) 0.83–0.88 with a
  shared entity merges; (c) 0.83–0.88 without a shared entity creates a new story; (d)
  0.83–0.88 with an entity-less article merges (fallback). Existing tests use ~0.9999
  cosine and stay in the auto-merge tier — unchanged.
- A `STORY_AUTO_MERGE_THRESHOLD` exact-value test.

## Known limitation (documented, deferred)
A shared *very common* entity (e.g. 中国/China) can corroborate loosely-related band
matches. Excluding low-salience / high-frequency entities from the overlap test is a
tunable follow-up, not in this change.

## Out of scope
- Changing the 0.83 floor or the recency weighting.
- Near-duplicate article detection (#2) and cross-language alias merging (#5).
- Any LLM involvement.
