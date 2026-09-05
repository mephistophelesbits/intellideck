# Phase 2b — Home UI Cutover to Topics — Design Spec

**Date:** 2026-06-24
**Status:** Approved (pending written-spec review)
**Parent:** [Digestion core redesign](2026-06-24-digestion-core-redesign-design.md). Phase 1 (topics model) and Phase 2a (live digestion + bounded LLM summaries + cached digest) are done and merged. This is Phase 2b: point the home at the topics surface.

## Goal

Replace the story-based `/home` with a **topics** view served from the deterministic digestion pipeline (`/api/digest` + a new topic-detail endpoint), so the user sees "what's going on / trending / escalating / worth reading" from the new system. Non-breaking to the backend; the old story components remain in the repo (deleted in Phase 2c).

## Decisions (from brainstorming)

- **Layout B:** a full-width "what's going on" digest hero banner on top; topic list (left) + topic detail (right) below.
- **Rich topic cards:** momentum badge + headline + one-line summary (when present) + signals row.
- **Hard cutover:** `/home` renders the topics view directly; old `SituationBoard`/`StoryDetailPanel`/`WorldSynthesisPanel` and the `/api/agent` fetch are dropped from the home (components stay in the codebase until 2c).

## Architecture

### New backend

- **`getTopicDetail(id)`** in `lib/server/topics-repository.ts` — returns the topic's display fields (id, topLine, momentum, articleCount, sourceCount, velocity, score, summary, lastSeenAt) plus its **member articles** (article id, title, url/canonical_url, source_title, published_at) ordered most-recent first. Returns `null` for an unknown/closed topic.
- **`GET /api/topics/[id]`** (`app/api/topics/[id]/route.ts`) — `200` with `{ topic, articles }` (the `getTopicDetail` shape), `404 { error }` for a missing id. `export const dynamic = 'force-dynamic'`.

### Home (`app/home/page.tsx`) — rewired

- Polls `GET /api/digest` (~90s, `cache: 'no-store'`) → `{ topics: RankedTopic[], trending: TrendingTag[], digest: { narrative, generatedAt } | null, meta: { total, breaking, escalating, generatedAt } }`.
- Renders (layout B): `<DigestHero>` on top; below it `<TopicBoard>` (left) + `<TopicDetailPanel>` (right).
- Holds `selectedTopicId`; selecting a card in the board sets it; the detail panel fetches that topic.
- Empty state when `topics.length === 0`: "Building your situation… topics appear as your feeds are digested."

### New components

- **`components/DigestHero.tsx`** — props `{ digest, meta, trending }`. Renders the digest `narrative` via the existing `<Markdown>` component; shows `breaking`/`escalating` counts and up to ~12 trending-tag chips. When `digest` is null, shows counts + trending with a quiet "digest generating…" note (no crash).
- **`components/TopicBoard.tsx`** — props `{ topics, selectedTopicId, onSelect }`. Rich cards: momentum badge (ported color/label config), headline (`topLine`), one-line `summary` when present (else headline only), signals row (`{articleCount} articles · {velocity}/hr · {sourceCount} sources · <TimeAgo lastSeenAt>`). Breaking/escalating get a colored left border.
- **`components/TopicDetailPanel.tsx`** — props `{ topicId }`. Fetches `/api/topics/[id]` (guards non-ok responses → renders empty, mirroring the `StoryDetailPanel` fix). Header (headline + signals), **Summary** section (`<Markdown>` of `summary`, or "No summary yet — this topic hasn't crossed the threshold"), and a recent-first **Articles** list (title links out, source + `<TimeAgo>`). No pin/chat/web-context.

### Reuse (don't rebuild)

Momentum badge color/label config and `TimeAgo` (from `SituationBoard`), the `<Markdown>` component (`components/ui/Markdown.tsx`), and the non-ok-response fetch guard pattern (from `StoryDetailPanel`).

## Data flow

```
worker (Phase 2a) ─ builds + summarizes topics ─▶ topics / topic_digest tables
/home ── poll /api/digest (90s) ──▶ DigestHero (narrative + counts + trending) + TopicBoard (cards)
         click card ── /api/topics/[id] ──▶ TopicDetailPanel (summary + member articles)
```

## States & error handling

- No active topics → home empty state ("Building your situation…").
- `digest` null → hero shows counts + trending only.
- Detail fetch non-ok / stale id (e.g. after a rebuild) → panel renders empty (guarded), never crashes.
- All `/api/digest`/`/api/topics` reads are from materialized fields → fast, no model in the request path.

## Testing

- **TDD (backend):** `getTopicDetail(id)` — returns topic + member articles recent-first; `null` for missing/closed. `/api/topics/[id]` route — 200 shape, 404 for unknown id.
- **UI:** the project has no component-test harness; components are verified via the dev-server preview (load `/home`, confirm hero + board + detail render and card selection drives the detail). No new test framework is introduced.

## Scope

- **New:** `getTopicDetail`, `/api/topics/[id]`, `DigestHero.tsx`, `TopicBoard.tsx`, `TopicDetailPanel.tsx`, the `app/home/page.tsx` rewire.
- **Reuse:** momentum config, `TimeAgo`, `<Markdown>`, the response-guard pattern.
- **Out of scope (Phase 2c):** deleting the old story components and retiring the old LLM sweeps (per-story/entity summaries, interval briefs, world synthesis) from the background worker.

## Open tunables

Poll interval (90s), trending-tag count in the hero (~12), member-article count in detail (~30). Defaults; adjustable after seeing it live.
