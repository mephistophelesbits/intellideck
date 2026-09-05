# Phase 2b — Home Cutover to Topics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the story-based `/home` with a topics view (digest hero + topic list + topic detail) served from `/api/digest` and a new `/api/topics/[id]`.

**Architecture:** A new `getTopicDetail` repository function + `/api/topics/[id]` endpoint feed a topic-detail panel. The home (`app/home/page.tsx`) is rewired to layout B: a `DigestHero` banner on top, `TopicBoard` (left) + `TopicDetailPanel` (right) below, polling `/api/digest`. Old story components stay in the repo (deleted in Phase 2c).

**Tech Stack:** TypeScript, Next.js App Router (client components), Tailwind, `node:sqlite`, Vitest. Reuses `components/ui/Markdown.tsx`, `components/ui/TimeAgo.tsx`, `@/lib/utils` `cn`.

---

## File Structure

- `lib/server/topics-repository.ts` *(modify)* — `getTopicDetail(id, limit)` + `TopicDetail`/`TopicDetailArticle` types (append).
- `app/api/topics/[id]/route.ts` *(create)* — GET topic detail (200 / 404).
- `components/DigestHero.tsx` *(create)* — full-width "what's going on" banner.
- `components/TopicBoard.tsx` *(create)* — ranked rich topic cards + momentum config.
- `components/TopicDetailPanel.tsx` *(create)* — selected-topic detail (summary + articles).
- `app/home/page.tsx` *(modify)* — rewire to topics (layout B).
- Test: `lib/server/topics-repository.detail.test.ts`.

The home currently renders `WorldSynthesisPanel` / `SituationBoard` / `StoryDetailPanel` fed by `/api/agent`. Those imports/usages are removed from the home (the component files are NOT deleted — that's Phase 2c).

---

## Task 1: `getTopicDetail` repository function

**Files:**
- Modify: `lib/server/topics-repository.ts` (append)
- Test: `lib/server/topics-repository.detail.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/server/topics-repository.detail.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
vi.mock('server-only', () => ({}));
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE articles (id TEXT PRIMARY KEY, title TEXT, canonical_url TEXT, source_title TEXT, published_at TEXT, created_at TEXT);`);
vi.mock('./db', async (orig) => ({ ...(await orig() as object), getDb: () => db }));
import { applyTopicsSchema } from './db';
applyTopicsSchema(db);
import { getTopicDetail } from './topics-repository';

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
beforeEach(() => { db.exec('DELETE FROM topics; DELETE FROM topic_articles; DELETE FROM articles;'); });

describe('getTopicDetail', () => {
  it('returns null for an unknown topic', () => {
    expect(getTopicDetail('nope')).toBeNull();
  });

  it('returns the topic fields and member articles, most-recent first', () => {
    db.prepare(`INSERT INTO topics (id,status,top_line,momentum,article_count,source_count,velocity,score,summary,first_seen_at,last_seen_at,summary_state,summary_article_count,created_at,updated_at)
                VALUES ('t','active','Headline','escalating',2,2,1.5,9,'A summary.',?,?,'fresh',2,?,?)`).run(iso(3000), iso(1000), iso(3000), iso(1000));
    db.prepare('INSERT INTO articles (id,title,canonical_url,source_title,published_at) VALUES (?,?,?,?,?)').run('a1', 'Old one', 'http://x/1', 'BBC', iso(3000));
    db.prepare('INSERT INTO articles (id,title,canonical_url,source_title,published_at) VALUES (?,?,?,?,?)').run('a2', 'New one', 'http://x/2', 'CNN', iso(1000));
    db.prepare('INSERT INTO topic_articles (topic_id,article_id,added_at) VALUES (?,?,?)').run('t', 'a1', iso(3000));
    db.prepare('INSERT INTO topic_articles (topic_id,article_id,added_at) VALUES (?,?,?)').run('t', 'a2', iso(1000));

    const d = getTopicDetail('t')!;
    expect(d.topLine).toBe('Headline');
    expect(d.momentum).toBe('escalating');
    expect(d.summary).toBe('A summary.');
    expect(d.articles.map((a) => a.title)).toEqual(['New one', 'Old one']); // recent first
    expect(d.articles[0]).toMatchObject({ url: 'http://x/2', source: 'CNN' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/server/topics-repository.detail.test.ts`
Expected: FAIL — `getTopicDetail` not exported.

- [ ] **Step 3: Implement** — append to `lib/server/topics-repository.ts`:

```ts
export interface TopicDetailArticle { id: string; title: string; url: string | null; source: string | null; publishedAt: string | null; }
export interface TopicDetail {
  id: string; topLine: string | null; momentum: string; articleCount: number; sourceCount: number;
  velocity: number; score: number; summary: string | null; lastSeenAt: string;
  articles: TopicDetailArticle[];
}

/** A topic's display fields plus its member articles (most-recent first) for the detail panel.
 *  Null when the topic id is unknown. Works for active and archived topics. */
export function getTopicDetail(topicId: string, articleLimit = 30): TopicDetail | null {
  const db = getDb();
  const t = db.prepare(
    `SELECT id, top_line AS topLine, momentum, article_count AS articleCount, source_count AS sourceCount,
            velocity, score, summary, last_seen_at AS lastSeenAt
     FROM topics WHERE id = ?`,
  ).get(topicId) as Omit<TopicDetail, 'articles'> | undefined;
  if (!t) return null;
  const articles = db.prepare(
    `SELECT a.id, a.title, a.canonical_url AS url, a.source_title AS source, a.published_at AS publishedAt
     FROM topic_articles ta JOIN articles a ON a.id = ta.article_id
     WHERE ta.topic_id = ? ORDER BY COALESCE(a.published_at, a.created_at) DESC LIMIT ?`,
  ).all(topicId, articleLimit) as TopicDetailArticle[];
  return { ...t, articles };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/server/topics-repository.detail.test.ts`
Expected: PASS (2 tests). Then full suite `npx vitest run` (all green).

- [ ] **Step 5: Commit**

```bash
git add lib/server/topics-repository.ts lib/server/topics-repository.detail.test.ts
git commit -m "feat(topics): getTopicDetail (topic + member articles)"
```

---

## Task 2: `/api/topics/[id]` route

**Files:**
- Create: `app/api/topics/[id]/route.ts`

No unit test (thin wrapper over the tested `getTopicDetail`); verified by tsc + the Task 6 smoke.

- [ ] **Step 1: Implement** `app/api/topics/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getTopicDetail } from '@/lib/server/topics-repository';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const detail = getTopicDetail(id);
  if (!detail) return NextResponse.json({ error: 'Topic not found' }, { status: 404 });
  return NextResponse.json(detail);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add "app/api/topics/[id]/route.ts"
git commit -m "feat(topics): /api/topics/[id] detail endpoint"
```

---

## Task 3: `DigestHero` component

**Files:**
- Create: `components/DigestHero.tsx`

UI component (no test harness in this project); built with complete code, verified via tsc here and the dev-server preview in Task 6.

- [ ] **Step 1: Implement** `components/DigestHero.tsx`:

```tsx
'use client';

import { Zap, TrendingUp, Hash } from 'lucide-react';
import { Markdown } from '@/components/ui/Markdown';
import { TimeAgo } from '@/components/ui/TimeAgo';

export interface DigestData { narrative: string; generatedAt: string }
export interface DigestMeta { total: number; breaking: number; escalating: number; generatedAt: string }
export interface TrendingTagItem { name: string; type: string; count: number }

export function DigestHero({ digest, meta, trending }: {
  digest: DigestData | null;
  meta: DigestMeta;
  trending: TrendingTagItem[];
}) {
  return (
    <div className="px-6 py-4 border-b border-border bg-background-secondary/40 flex-shrink-0">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h1 className="text-sm font-semibold flex items-center gap-2">
          <Zap className="w-4 h-4 text-accent" /> What's going on
        </h1>
        <div className="flex items-center gap-2 text-xs">
          {meta.breaking > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30 font-bold animate-pulse">{meta.breaking} breaking</span>
          )}
          {meta.escalating > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-400/30">{meta.escalating} escalating</span>
          )}
          <span className="text-foreground-secondary/60">{meta.total} topics</span>
        </div>
      </div>

      {digest ? (
        <Markdown className="text-sm text-foreground/90 leading-relaxed">{digest.narrative}</Markdown>
      ) : (
        <p className="text-xs text-foreground-secondary/50 italic">Digest generating… (updates on the worker schedule)</p>
      )}

      {trending.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mt-3">
          <TrendingUp className="w-3 h-3 text-foreground-secondary/40 flex-shrink-0" />
          {trending.slice(0, 12).map((t) => (
            <span key={t.name} className="text-[11px] px-2 py-0.5 rounded-full bg-background-tertiary text-foreground-secondary/80 flex items-center gap-1">
              <Hash className="w-2.5 h-2.5 opacity-50" />{t.name}<span className="text-foreground-secondary/40">{t.count}</span>
            </span>
          ))}
        </div>
      )}

      {digest && (
        <p className="text-[10px] text-foreground-secondary/40 mt-2">Updated <TimeAgo date={digest.generatedAt} /></p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. (If `TimeAgo`'s prop name differs, open `components/ui/TimeAgo.tsx` and match it — it takes a `date` string prop in this codebase.)

- [ ] **Step 3: Commit**

```bash
git add components/DigestHero.tsx
git commit -m "feat(home): DigestHero banner"
```

---

## Task 4: `TopicBoard` component

**Files:**
- Create: `components/TopicBoard.tsx`

- [ ] **Step 1: Implement** `components/TopicBoard.tsx`:

```tsx
'use client';

import { cn } from '@/lib/utils';
import { TimeAgo } from '@/components/ui/TimeAgo';

export interface TopicCard {
  id: string; topLine: string | null; articleCount: number; sourceCount: number;
  velocity: number; momentum: string; score: number; lastSeenAt: string; summary: string | null;
}

const MOMENTUM: Record<string, { label: string; badge: string; border: string }> = {
  breaking:   { label: 'BREAKING',   badge: 'bg-red-500/15 text-red-400 border-red-500/30',                  border: 'border-l-2 border-l-red-500' },
  escalating: { label: 'ESCALATING', badge: 'bg-orange-500/15 text-orange-400 border-orange-400/30',         border: 'border-l-2 border-l-orange-400' },
  developing: { label: 'DEVELOPING', badge: 'bg-accent/15 text-accent border-accent/30',                     border: '' },
  steady:     { label: 'STEADY',     badge: 'bg-background-tertiary text-foreground-secondary border-border', border: '' },
  quiet:      { label: 'QUIET',      badge: 'bg-background-tertiary text-foreground-secondary/60 border-border', border: '' },
};

export function TopicBoard({ topics, selectedTopicId, onSelect }: {
  topics: TopicCard[];
  selectedTopicId: string | null;
  onSelect: (id: string) => void;
}) {
  if (topics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-foreground-secondary gap-2 px-6 text-center">
        <p className="text-sm">Building your situation…</p>
        <p className="text-xs text-foreground-secondary/60">Topics appear as your feeds are digested.</p>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto">
      {topics.map((t) => {
        const cfg = MOMENTUM[t.momentum] ?? MOMENTUM.steady;
        const selected = t.id === selectedTopicId;
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className={cn(
              'w-full text-left px-6 py-4 border-b border-border/50 transition-colors hover:bg-background-tertiary/50 focus:outline-none',
              selected ? 'bg-accent/10 ring-2 ring-inset ring-accent' : cfg.border,
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={cn('text-[10px] font-bold tracking-widest px-2 py-0.5 rounded border flex-shrink-0', cfg.badge)}>{cfg.label}</span>
              <h3 className="text-sm font-medium truncate flex-1">{t.topLine ?? 'Untitled topic'}</h3>
            </div>
            {t.summary && <p className="text-sm text-foreground-secondary leading-snug line-clamp-2 mb-1.5">{t.summary}</p>}
            <div className="flex items-center gap-3 text-xs text-foreground-secondary">
              <span>{t.articleCount} {t.articleCount === 1 ? 'article' : 'articles'}</span>
              {t.velocity > 0 && <span className="text-accent">{t.velocity.toFixed(1)}/hr</span>}
              <span>{t.sourceCount} {t.sourceCount === 1 ? 'source' : 'sources'}</span>
              <TimeAgo date={t.lastSeenAt} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add components/TopicBoard.tsx
git commit -m "feat(home): TopicBoard ranked rich cards"
```

---

## Task 5: `TopicDetailPanel` component

**Files:**
- Create: `components/TopicDetailPanel.tsx`

- [ ] **Step 1: Implement** `components/TopicDetailPanel.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Markdown } from '@/components/ui/Markdown';
import { TimeAgo } from '@/components/ui/TimeAgo';

interface DetailArticle { id: string; title: string; url: string | null; source: string | null; publishedAt: string | null }
interface TopicDetailResponse {
  id: string; topLine: string | null; momentum: string; articleCount: number; sourceCount: number;
  velocity: number; score: number; summary: string | null; lastSeenAt: string; articles: DetailArticle[];
}

export function TopicDetailPanel({ topicId, className }: { topicId: string | null; className?: string }) {
  const [detail, setDetail] = useState<TopicDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!topicId) { setDetail(null); return; }
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    fetch(`/api/topics/${topicId}`)
      // a stale id (e.g. after a rebuild) returns a 404 error body, not detail — don't treat it as data
      .then((r) => (r.ok ? (r.json() as Promise<TopicDetailResponse>) : Promise.reject(new Error('Topic not found'))))
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((err) => { if (!cancelled) { console.error(err); setDetail(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [topicId]);

  if (!topicId) {
    return <div className={cn('flex items-center justify-center text-foreground-secondary', className)}><p className="text-sm">Select a topic to read</p></div>;
  }
  if (loading) {
    return <div className={cn('flex items-center justify-center', className)}><Loader2 className="w-5 h-5 animate-spin text-accent" /></div>;
  }
  if (!detail) return null;

  return (
    <div className={cn('flex flex-col overflow-hidden', className)}>
      <div className="px-6 py-4 border-b border-border flex-shrink-0">
        <h2 className="font-semibold text-lg leading-snug">{detail.topLine ?? 'Untitled topic'}</h2>
        <div className="flex items-center gap-3 mt-1.5 text-xs text-foreground-secondary">
          <span className="uppercase tracking-wider">{detail.momentum}</span>
          <span>{detail.articleCount} articles</span>
          {detail.velocity > 0 && <span className="text-accent">{detail.velocity.toFixed(1)}/hr</span>}
          <span>{detail.sourceCount} sources</span>
          <TimeAgo date={detail.lastSeenAt} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-4 border-b border-border/50">
          {detail.summary
            ? <Markdown className="text-base text-foreground">{detail.summary}</Markdown>
            : <p className="text-sm text-foreground-secondary/60 italic">No summary yet — this topic hasn't crossed the threshold.</p>}
        </div>

        <div className="px-6 py-4">
          <p className="text-xs font-medium text-foreground-secondary/60 uppercase tracking-wider mb-3">{detail.articles.length} articles</p>
          <div className="space-y-3">
            {detail.articles.map((a) => (
              <a
                key={a.id}
                href={a.url || undefined}
                target={a.url ? '_blank' : undefined}
                rel="noopener noreferrer"
                className="block group"
              >
                <p className="text-sm text-foreground group-hover:text-accent transition-colors leading-snug flex items-start gap-1.5">
                  <span className="flex-1">{a.title}</span>
                  {a.url && <ExternalLink className="w-3 h-3 mt-1 flex-shrink-0 text-foreground-secondary/40" />}
                </p>
                <p className="text-xs text-foreground-secondary/60 mt-0.5">
                  {a.source || 'Unknown source'}{a.publishedAt && <> · <TimeAgo date={a.publishedAt} /></>}
                </p>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add components/TopicDetailPanel.tsx
git commit -m "feat(home): TopicDetailPanel (summary + member articles)"
```

---

## Task 6: Rewire `app/home/page.tsx` + verify

**Files:**
- Modify: `app/home/page.tsx`

- [ ] **Step 1: Replace `app/home/page.tsx`** with the topics version (keeps `AppChrome` + `AgentStatusBar`, drops the story panels):

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppChrome } from '@/components/AppChrome';
import { DigestHero, type DigestData, type DigestMeta, type TrendingTagItem } from '@/components/DigestHero';
import { TopicBoard, type TopicCard } from '@/components/TopicBoard';
import { TopicDetailPanel } from '@/components/TopicDetailPanel';
import { AgentStatusBar, useAgentStatus } from '@/components/AgentStatusBar';

interface DigestResponse { topics: TopicCard[]; trending: TrendingTagItem[]; digest: DigestData | null; meta: DigestMeta }

export default function HomePage() {
  const [data, setData] = useState<DigestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const { status, loading: statusLoading, reload: reloadStatus } = useAgentStatus();

  const fetchDigest = useCallback(async () => {
    try {
      const res = await fetch('/api/digest', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch digest');
      setData(await res.json() as DigestResponse);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    void fetchDigest();
    const id = setInterval(() => void fetchDigest(), 90_000);
    return () => clearInterval(id);
  }, [fetchDigest]);

  const handleSelect = useCallback((id: string) => {
    setSelectedTopicId((prev) => (prev === id ? null : id));
  }, []);

  const topics = data?.topics ?? [];
  const meta = data?.meta ?? { total: 0, breaking: 0, escalating: 0, generatedAt: '' };

  return (
    <AppChrome showAddFeedAction={false} onRefreshAll={fetchDigest}>
      <div className="flex flex-col h-full overflow-hidden">
        <AgentStatusBar status={status} loading={statusLoading} reload={reloadStatus} />
        <DigestHero digest={data?.digest ?? null} meta={meta} trending={data?.trending ?? []} />
        {error && <p className="text-xs text-red-400 px-6 py-2">{error}</p>}
        <div className="flex flex-1 overflow-hidden min-h-0">
          <div className="w-[560px] flex-shrink-0 flex flex-col overflow-hidden border-r border-border">
            <TopicBoard topics={topics} selectedTopicId={selectedTopicId} onSelect={handleSelect} />
          </div>
          <div className="flex-1 overflow-hidden min-w-0">
            <TopicDetailPanel topicId={selectedTopicId} className="h-full bg-background" />
          </div>
        </div>
      </div>
    </AppChrome>
  );
}
```

> Note: this drops `WorldSynthesisPanel`, `SituationBoard`, `StoryDetailPanel`, `useBreakingAlerts`, `useSituationStore`, and `HomeEmptyState` from the home. Those files remain in the repo (Phase 2c removes them). If `AppChrome`'s prop names differ, open `components/AppChrome.tsx` and match them (it currently takes `showAddFeedAction` and `onRefreshAll`).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. Then run the full suite `npx vitest run` — expected all green (no test files changed).

- [ ] **Step 3: Commit**

```bash
git add app/home/page.tsx
git commit -m "feat(home): cut /home over to the topics digest view"
```

- [ ] **Step 4: Manual smoke (preview)** — this is the validation gate; do it from the project root (NOT a node_modules-symlinked worktree, which breaks the Next dev server). Coordinator runs this after merge:

1. Ensure topics exist: `curl -s -X POST http://localhost:3001/api/digest/rebuild >/dev/null`
2. Load `http://localhost:3001/home` in the preview. Confirm: the DigestHero shows counts + trending (and the narrative once the worker has generated it); the TopicBoard lists topics with momentum badges + one-line summaries on escalating/breaking ones; clicking a card loads its detail (summary + member articles, links open out); selecting another card swaps the detail; no console errors.

---

## Self-Review notes

- **Spec coverage:** new endpoint + `getTopicDetail` (Tasks 1-2); `DigestHero` (Task 3); `TopicBoard` rich cards + momentum config + empty state (Task 4); `TopicDetailPanel` with summary + articles + non-ok guard (Task 5); home rewire to layout B + 90s poll (Task 6). States: empty board (Task 4), null digest (Task 3), stale-id guard (Task 5). Out of scope (2c): deleting old components — correctly NOT done here.
- **Type consistency:** `TopicCard`/`TopicDetail`/`TopicDetailArticle`/`DigestData`/`DigestMeta`/`TrendingTagItem`, `getTopicDetail(id, limit)`, the `/api/digest` response shape, and `momentum` string values (breaking/escalating/developing/steady/quiet) are used consistently. `TimeAgo` is passed a `date` prop everywhere; `Markdown` takes `children` + `className`.
- **No placeholders:** every component/step has complete code.

## Validation gate before Phase 2c

After Task 6, with the worker running on real data, confirm the topics home is genuinely useful (digest reads well, momentum/summaries are right, detail works). Only then plan Phase 2c — delete the old story components and remove the old LLM sweeps (per-story/entity summaries, interval briefs, world synthesis) from `background-worker.ts`.
