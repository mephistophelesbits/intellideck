# Smarter Salience — Design

**Date:** 2026-06-23
**Goal:** Replace pure article-count salience with a recency-decayed blend of volume and
source diversity, so the situation board and the LLM-brief budget favor fresh,
well-sourced stories instead of large-but-stale ones.

## Motivation

`salience` is `+1` per article (stories-repository.ts:96). It drives three things: the
situation-board order, `getRankedStories`, and which dirty top-5 stories get an LLM
brief (`regenerateDirtyStorySummaries`). Pure volume means a big, old topic outranks a
small, breaking, multi-source one — the wrong stories get attention and the LLM budget.

## Formula

New module `lib/server/story-salience.ts` with a pure core:

```
export function computeSalience(articleCount: number, distinctSources: number, ageDays: number): number
```

```
recencyDecay = 0.5 ^ (ageDays / SALIENCE_HALF_LIFE_DAYS)        // half-life = 3 days
salience     = recencyDecay * (articleCount + SOURCE_BONUS * distinctSources)  // SOURCE_BONUS = 1
```

- Recency is a global multiplier — a big-but-old story decays below a smaller fresh one.
- Source diversity adds `SOURCE_BONUS` per distinct source (multi-source > single-source
  at equal volume).
- `SALIENCE_HALF_LIFE_DAYS = 3` and `SOURCE_BONUS = 1` are named, tunable constants.
- Unparseable / future `last_updated` → `ageDays = 0` (no decay), matching the existing
  `recencyWeight` convention in story-assignment. Zero articles → 0.

Velocity and unread signals are intentionally excluded.

## Recompute (periodic)

Salience depends on age, which drifts continuously, so it cannot be a write-time
increment. Add to `story-salience.ts`:

```
export function recomputeActiveSalience(limit = 200): number
```

One batch query fetches active (`status != 'closed'`) stories' `article_count`,
`last_updated`, and distinct-`source_url` count (`story_articles` ⋈ `articles`),
computes `computeSalience(...)` in JS, and `UPDATE stories SET salience = ?`. Returns
the number updated.

## Worker integration

In `background-worker.ts`'s "story maintenance" pass, call `recomputeActiveSalience()`
**first**, so the subsequent `regenerateDirtyStorySummaries` (picks dirty top-5 by
salience) and the board see fresh salience. `refreshDeterministicMetadata`, the dormant
transition, and the gated summary pass stay after it.

The attach-path `salience = salience + 1` (stories-repository.ts:96) stays as a cheap
interim freshness bump between ticks; the tick overwrites it with the authoritative
blended value (≤60s later). Minimal-change, no interim-ordering regression.

## Data flow

```
worker tick (idle) → recomputeActiveSalience():
  for each active story: salience = 0.5^(ageDays/3) * (articleCount + 1*distinctSources)
→ regenerateDirtyStorySummaries picks dirty top-5 by fresh salience (LLM briefs)
→ getSituationBoard / getRankedStories order by fresh salience
```

## Error handling
- `recomputeActiveSalience` runs inside the worker's `runMaintenancePass` try/catch
  (one pass failing never aborts the others). Plain SQLite reads/writes.

## Testing
- `story-salience.test.ts` (pure unit on `computeSalience`):
  - fresh 5-article/5-source > fresh 5-article/1-source (source diversity matters);
  - old (≥2 half-lives) 20-article story < fresh 3-article story (recency dominates);
  - `ageDays = 0` → no decay (salience == articleCount + distinctSources);
  - 0 articles / 0 sources → 0.
- `recomputeActiveSalience` (in-memory DB): writes a decayed blended value; counts
  distinct sources via the `story_articles ⋈ articles` join (3 articles / 2 sources →
  uses 2); skips `closed` stories; returns the updated count.

## Out of scope
- Velocity and unread-event signals.
- Changing dormant transitions or the board's `computeMomentum` display logic.
- Tuning the constants against live data (ship sane defaults; tune later).
