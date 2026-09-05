# Digestion Core Redesign — Design Spec

**Date:** 2026-06-24
**Status:** Approved (pending written-spec review)

## Problem

The home page is fast to *read* (every endpoint returns in <150ms), but the backend
**digestion pipeline is a traffic jam**. Every 60s the background worker tries to regenerate,
serially, on one slow local model (`gemma3:12b`, ~9s/call):

- per-story LLM summaries for *any* dirty story (thousands of stories, continuously
  re-dirtied by ingestion),
- per-entity LLM summaries (~29k entities),
- interval briefs, and a daily master synthesis.

This LLM synthesis layer can never catch up, so it perpetually backs up. Meanwhile the system
also re-scores an ever-growing 5,170 stories / 29k entities forever, even though "what's going
on now" only needs a recent slice.

The goal is a **lean system that quickly tells the user what's going on, what's trending,
what's escalating, and what's worth reading** — fast and effective.

## Goals

- Grouping, tagging, ranking are **deterministic and continuous** — never wait on the LLM.
- The LLM is involved **only** when a topic has "earned" it (accumulated enough articles within
  a time window) — and even then via a decoupled, rate-capped queue that cannot back up.
- The active working set is **bounded by a rolling time window**, not total history.
- The three surfaces — trending, escalating, worth-reading — plus a single "what's going on"
  digest, are served from pre-computed fields.

## Non-Goals

- Per-entity intelligence summaries (dropped — entities become lightweight tags).
- Perpetual story history in the hot model (older topics are archived, still searchable).
- Rich per-story LLM fields (actors/trajectory/stakes/stance history) — dropped.

## Decisions (from brainstorming)

1. **LLM role:** deterministic core + threshold-triggered per-topic summary + one cached
   "what's going on" digest. No LLM in the digestion hot path.
2. **Build approach:** reengineer the digestion core (clean schema), porting the working
   deterministic bits.
3. **Time model:** rolling recent window (default 72h); quiet topics age out → archived;
   recurring topics reactivate.
4. **Architecture:** Approach A — incremental "active topics" over a rolling window (keeps
   stable topic identity, which "escalating" requires).

---

## Architecture (Approach A)

### Data model

- **`articles`** *(keep, append-only)* — raw article (`title`, `content_snippet`,
  `raw_content`, `source_title`, `published_at`, `fetched_at`), embedding in `article_vectors`
  (sqlite-vec), and deterministic tags (lightweight entities: normalized name + type, **no
  summaries**).
- **`topics`** *(new — the core)* — one row per cluster, everything the surface needs
  pre-computed:
  - identity: `id`, `centroid`, `representative_article_id`
  - deterministic display: `top_line` (lead headline + key tags), `article_count`,
    `source_count`, `first_seen_at`, `last_seen_at`, `velocity`, `momentum`
    (breaking/escalating/developing/steady/quiet), `score`
  - LLM (optional): `summary`, `summary_state` (none/queued/fresh), `summary_at`,
    `summary_article_count` (count when last summarized — drives cooldown)
  - `status`: active | archived
- **`topic_articles`** — membership (`topic_id`, `article_id`, `added_at`).

No separate jobs table and no signal-history table: velocity/escalation are computed from
`topic_articles.added_at`; the LLM queue is just `topics WHERE summary_state='queued'` ordered
by priority.

### Lifecycle

- **Window** (config, default 72h). Active set = topics with `last_seen_at` ≥ now − window.
- **Archival**: a cheap periodic sweep flips topics with no article in the window to
  `archived` — frozen, searchable, out of hot ranking and the assignment-candidate set.
- **Reactivation**: a new article matching an *archived* topic (same specific entity + cosine)
  flips it back to active — recurring threads resume their identity instead of duplicating.

The working set is bounded by the window (dozens–hundreds of active topics); ranking/scoring
only ever runs over the active set.

### Deterministic digestion (continuous, LLM-free)

Per article, as it arrives (ported from the current clustering, scoped to the window):

1. **Embed** — batched Ollama `/api/embed` (the only model call; fast).
2. **Tag** — deterministic entities (jieba `ns`/`nr`/`nt` + colon-subject orgs + Latin regex)
   and category.
3. **Assign to topic** — candidate set = active topics in window (recency ∪ entity-anchored),
   gated by cosine ≥ threshold **AND** IDF entity-overlap ≥ threshold; else reactivate a
   matching archived topic; else create a new topic.
4. **Recompute that topic's denormalized fields** — `article_count`, `source_count`,
   `first/last_seen`, `velocity`, `momentum`, `score`, refresh `top_line` from the lead
   article. One topic touched per article — cheap, no global rescore.

A separate lightweight sweep (every few minutes) does archival + refreshes the trending
snapshot. Both are window-bounded, so they stay fast regardless of total history.

### Signals & ranking (pure SQL over `topic_articles.added_at`)

- **velocity** = articles in last *H* h ÷ *H*.
- **momentum / escalating** = count in recent half-window vs prior half-window → ratio buckets
  into breaking / escalating / developing / steady / quiet. Measured on a *stable* topic id.
- **worth-reading score** = weighted blend of velocity, source diversity, and recency decay.
- **trending** = top active topics by velocity×volume; **trending tags** = top entities by
  windowed mention-velocity (cheap `article_entities` aggregate over the window).

### LLM layer (decoupled, gated, rate-capped)

- **Eligibility:** `article_count ≥ N` **AND** momentum ∈ {escalating, breaking} **AND** the
  summary is stale (none, OR `article_count` grew ≥ X% since `summary_article_count`, OR past a
  hard cooldown, e.g. 30 min). Eligible → `summary_state='queued'`.
- **Consumer:** pulls queued topics by **priority = momentum × staleness**, processes at most
  **K per minute** (matched to model throughput → bounded by construction). Writes `summary`,
  sets `summary_state='fresh'`, stamps `summary_at` + `summary_article_count`. Failure → leave
  queued, retry with backoff (rate cap prevents snowball).
- **"What's going on" digest:** one scheduled call (every 30–60 min) composed from the top
  deterministic topics' top-lines (does not re-summarize each). Cached, async. Replaces
  `world-synthesis` / `interval-brief` / master-briefing.
- **Optional lever:** point summaries at a smaller/faster model than `gemma3:12b`.

### Read surface

- **`/api/digest`** — ranked active topics (deterministic `top_line` + signals + `summary` if
  present), trending tags, cached digest. All from materialized fields → fast, no model in the
  request path.
- Opening a topic shows top-line + member articles instantly; if unsummarized, bump its
  priority on open (still non-blocking).

---

## Migration

**Port:** `article_vectors` + `embedTextBatch`; `cjk-ner` / `entity-extraction` / Latin regex;
the clustering decision (cosine + IDF overlap + entity-anchored candidates) re-targeted onto
`topics` with a windowed candidate set; feed ingestion.

**Drop / retire:** `regenerateDirtyStorySummaries` (dirty-flag churn);
`regenerateDirtyEntitySummaries` + entity intelligence; `interval-brief`, `world-synthesis`,
daily master-briefing; `actor_stance_history` + per-story actor/trajectory/stakes; the
perpetual `stories`/`story_events` model.

**One-time data migration:** create new tables; rebuild `topics` by running deterministic
assignment over **last-window** articles only (oldest-first), reusing stored embeddings +
re-extracted tags. Older content left archived/ignored — no reprocessing 22k. Old tables
dropped after cutover (or in a follow-up).

## Phased rollout

- **Phase 1:** topics model + deterministic digestion + `/api/digest` running **alongside** the
  current home (no LLM sweep changes yet). Validate clustering/signals on real data.
- **Phase 2:** add the decoupled threshold-triggered LLM consumer + cached digest; cut the home
  page over to `/api/digest`; retire the old LLM sweeps and the `stories`/entity-summary
  subsystems.

## Testing (TDD)

- **Unit:** topic assignment (merge/new/reactivate); momentum/velocity formulas (breaking vs
  escalating vs quiet on synthetic timelines); worth-reading score ordering; LLM eligibility +
  cooldown (no re-summarize until delta/cooldown); archival + reactivation.
- **Integration:** a window of synthetic articles → expected active topics, signals, and
  exactly which topics become LLM-eligible (asserting the model is **not** called for
  cold/below-threshold topics).
- **Throughput guard:** the LLM consumer never exceeds K/min; the deterministic path never
  awaits the model.

## Open tunables (defaults, adjustable after observing real data)

- Window length: **72h**.
- LLM eligibility: `N` articles (e.g. 5), momentum ≥ escalating, staleness delta `X%` (e.g.
  50%), cooldown (e.g. 30 min).
- Consumer rate cap `K`/min (e.g. 2–4, matched to model).
- Summary model (keep `gemma3:12b` vs a faster small model).
