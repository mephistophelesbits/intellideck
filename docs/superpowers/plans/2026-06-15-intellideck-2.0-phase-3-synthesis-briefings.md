# IntelliDeck 2.0 — Phase 3: Synthesis Briefings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a daily briefing that **reasons across the Phase 2 stories** (convergence, conflict, unconfirmed/thin claims, connections no single story states) instead of listing articles — generated automatically once a day on the worker, surfaced as a pinned card on Today and kept in the existing archive.

**Architecture:** A new server module pulls the top salient stories (Phase 2 `getRankedStories` + `getStoryDetail` timelines), builds a cross-source synthesis prompt, calls the configured Ollama model (`gemma4:12b-mlx`) with an output-sized `numCtx`, and persists the result via the existing `saveBriefing` into the existing `briefings` table (reusing the archive UI). Generation is scheduled once/day on the background-worker tick (gated by `briefingSettings.times` + `lastGenerated`) and also exposed via the repurposed manual `POST /api/briefings/generate`. A pinned `BriefingCard` shows the latest briefing at the top of the Today Stories feed.

**Decisions locked (from brainstorming):**
- The story-synthesis briefing **replaces** the old article-based daily briefing. The `POST /api/briefings/generate` route is repurposed to call the new server-side synthesis (the old article-listing logic is removed). The `briefings` table, `saveBriefing`, archive UI, and chat-on-briefing are reused unchanged.
- Generation is **scheduled daily on the worker** (reusing `briefingSettings.times` + `briefingSettings.lastGenerated`), plus the manual trigger.
- **Credibility is prompt-based only** — the synthesis prompt asks the model to flag thin/single-source/unconfirmed claims from the content itself. No credibility DB/feature is built (deferred to a future phase). Do NOT add a credibility column or scoring.

**Tech Stack:** `node:sqlite` + Ollama (`generateText` + `AIRequestOptions.numCtx`) + Next.js App Router + React + Vitest. Reuses: `getRankedStories`/`getStoryDetail` ([lib/server/stories-repository.ts](../../../lib/server/stories-repository.ts)), `saveBriefing`/`StoredBriefing`/`getBriefings` ([lib/server/briefings-repository.ts](../../../lib/server/briefings-repository.ts)), `getServerAISettings` + `getPersistedSettings`/`savePersistedSettings`/`getDefaultSettingsSnapshot` ([lib/server/settings-repository.ts](../../../lib/server/settings-repository.ts), [lib/settings-store.ts](../../../lib/settings-store.ts)), `generateText` ([lib/ai/providers.ts](../../../lib/ai/providers.ts)), `computeNumCtx` ([lib/ai/ollama-utils.ts](../../../lib/ai/ollama-utils.ts)), the worker tick ([lib/server/background-worker.ts](../../../lib/server/background-worker.ts)).

**Constant:** synthesize the top `8` stories by salience.

**Done when:** each morning a briefing is generated that reasons across stories (not a list), appears pinned on Today and in the archive, and can also be triggered manually.

---

## File Structure

**Create:**
- `lib/server/briefing-synthesis.ts` + `.test.ts` — pull top stories, build cross-source prompt, call LLM, parse, save.
- `app/api/briefings/latest/route.ts` — latest briefing for the pinned card.
- `components/ui/BriefingCard.tsx` — pinned synthesis card (fetches latest, expandable).

**Modify:**
- `lib/server/briefings-repository.ts` — add `getLatestBriefing()`.
- `app/api/briefings/generate/route.ts` — repurpose to call `generateSynthesisBriefing()` (remove article-based logic).
- `lib/server/background-worker.ts` — add `runDailySynthesisIfDue` to the tick.
- `components/StoriesFeed.tsx` — render `BriefingCard` pinned at the top.
- `lib/i18n/en.json`, `lib/i18n/zh-CN.json` — briefing-card strings.

---

## Task 1: `getLatestBriefing` repository helper

**Files:**
- Modify: `lib/server/briefings-repository.ts`
- Test: `lib/server/briefings-repository.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/server/briefings-repository.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/utils', () => ({ generateId: () => 'gen-' + Math.random().toString(36).slice(2, 8) }));

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE briefings (
    id TEXT PRIMARY KEY, briefing_date TEXT NOT NULL, title TEXT NOT NULL,
    executive_summary TEXT NOT NULL, key_themes_json TEXT NOT NULL, top_stories_json TEXT NOT NULL,
    scope_json TEXT NOT NULL, created_at TEXT NOT NULL, model_provider TEXT, model_name TEXT
  );
  CREATE TABLE briefing_chat_messages (
    id TEXT PRIMARY KEY, briefing_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
  );
`);
vi.mock('./db', () => ({ getDb: () => db }));

import { saveBriefing, getLatestBriefing } from './briefings-repository';

beforeEach(() => { db.exec('DELETE FROM briefings; DELETE FROM briefing_chat_messages;'); });

describe('getLatestBriefing', () => {
  it('returns null when there are no briefings', () => {
    expect(getLatestBriefing()).toBeNull();
  });

  it('returns the most recent briefing by date then created_at', () => {
    saveBriefing({ briefingDate: '2026-06-13', title: 'Older', executiveSummary: 'a', keyThemes: [], topStories: [], modelProvider: 'ollama', modelName: 'm' });
    const newer = saveBriefing({ briefingDate: '2026-06-15', title: 'Newer', executiveSummary: 'b', keyThemes: ['x'], topStories: [], modelProvider: 'ollama', modelName: 'm' });
    const latest = getLatestBriefing();
    expect(latest!.id).toBe(newer!.id);
    expect(latest!.title).toBe('Newer');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/server/briefings-repository.test.ts`
Expected: FAIL (`getLatestBriefing` not exported).

- [ ] **Step 3: Implement**

In `lib/server/briefings-repository.ts`, add after `getLatestTodaySummary` (it already has a `mapBriefingRow` helper used by other getters — reuse it):

```ts
export function getLatestBriefing() {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM briefings
    ORDER BY briefing_date DESC, created_at DESC
    LIMIT 1
  `).get();
  return row ? mapBriefingRow(row) : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/server/briefings-repository.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/briefings-repository.ts lib/server/briefings-repository.test.ts
git commit -m "feat: add getLatestBriefing repository helper"
```

---

## Task 2: Synthesis generator module

**Files:**
- Create: `lib/server/briefing-synthesis.ts`
- Test: `lib/server/briefing-synthesis.test.ts`

> Orchestration: pull top stories → build cross-source prompt → `generateText` → parse executive summary + key themes → `saveBriefing`. The test mocks the providers, stories repo, settings, and briefings repo, and asserts the orchestration + parsing.

- [ ] **Step 1: Write the failing test**

Create `lib/server/briefing-synthesis.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const generateText = vi.fn();
vi.mock('@/lib/ai/providers', () => ({ generateText: (...a: unknown[]) => generateText(...a) }));

const getRankedStories = vi.fn();
const getStoryDetail = vi.fn();
vi.mock('./stories-repository', () => ({
  getRankedStories: (...a: unknown[]) => getRankedStories(...a),
  getStoryDetail: (...a: unknown[]) => getStoryDetail(...a),
}));

const saveBriefing = vi.fn((b) => ({ id: 'b1', createdAt: 't', ...b }));
vi.mock('./briefings-repository', () => ({ saveBriefing: (...a: unknown[]) => saveBriefing(...a) }));

let aiEnabled = true;
vi.mock('./settings-repository', () => ({
  getServerAISettings: () => ({ enabled: aiEnabled, provider: 'ollama', model: 'gemma4:12b-mlx', baseUrl: undefined, apiKey: undefined }),
}));

import { generateSynthesisBriefing } from './briefing-synthesis';

beforeEach(() => { vi.clearAllMocks(); aiEnabled = true; });

const story = (id: string, title: string, salience: number) => ({
  id, title, status: 'developing', summary: `${title} summary`, articleCount: 3, salience, lastUpdated: '2026-06-15T00:00:00.000Z', newEventCount: 0,
});

describe('generateSynthesisBriefing', () => {
  it('returns null when AI is disabled', async () => {
    aiEnabled = false;
    expect(await generateSynthesisBriefing()).toBeNull();
    expect(generateText).not.toHaveBeenCalled();
  });

  it('returns null when there are no stories', async () => {
    getRankedStories.mockReturnValue([]);
    expect(await generateSynthesisBriefing()).toBeNull();
    expect(saveBriefing).not.toHaveBeenCalled();
  });

  it('synthesizes across stories and saves a briefing with parsed themes', async () => {
    getRankedStories.mockReturnValue([story('s1', 'Export controls', 5), story('s2', 'Quake', 3)]);
    getStoryDetail.mockImplementation((id: string) => ({
      story: { title: id === 's1' ? 'Export controls' : 'Quake' },
      events: [{ summary: 'dev one' }, { summary: 'dev two' }],
    }));
    generateText.mockResolvedValue({
      text: '## Executive Summary\nSources converge on X; Y is unconfirmed.\n\n## Key Themes\n- Trade policy\n- Seismic risk',
    });

    const result = await generateSynthesisBriefing();

    expect(generateText).toHaveBeenCalledTimes(1);
    // prompt should include both story titles and their developments
    const prompt = generateText.mock.calls[0][1] as string;
    expect(prompt).toContain('Export controls');
    expect(prompt).toContain('dev one');
    expect(saveBriefing).toHaveBeenCalledTimes(1);
    const saved = saveBriefing.mock.calls[0][0];
    expect(saved.executiveSummary).toContain('converge');
    expect(saved.keyThemes).toEqual(['Trade policy', 'Seismic risk']);
    expect(saved.topStories.map((s: { title: string }) => s.title)).toEqual(['Export controls', 'Quake']);
    expect(saved.topStories[0].articleId).toBe('s1'); // story id reused as ref
    expect(result).not.toBeNull();
  });

  it('returns null and does not save when the model call throws', async () => {
    getRankedStories.mockReturnValue([story('s1', 'X', 5)]);
    getStoryDetail.mockReturnValue({ story: { title: 'X' }, events: [] });
    generateText.mockRejectedValue(new Error('down'));
    expect(await generateSynthesisBriefing()).toBeNull();
    expect(saveBriefing).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/server/briefing-synthesis.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `lib/server/briefing-synthesis.ts`:

```ts
import 'server-only';

import { generateText } from '@/lib/ai/providers';
import { computeNumCtx } from '@/lib/ai/ollama-utils';
import { getServerAISettings } from './settings-repository';
import { getRankedStories, getStoryDetail } from './stories-repository';
import { saveBriefing, type StoredBriefing } from './briefings-repository';

const TOP_STORY_COUNT = 8;
const EVENTS_PER_STORY = 8;

function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function parseKeyThemes(text: string): string[] {
  const match = text.match(/##+\s*(?:Key Themes|关键主题)\s*([\s\S]*?)(?:\n##|$)/i);
  if (!match) return [];
  return match[1]
    .split('\n')
    .map((line) => line.replace(/^[\s\-*\d.)]+/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, 10);
}

function buildPrompt(blocks: string[], locale: string): string {
  const base = [
    'You are a news intelligence analyst. Synthesize ACROSS the developing stories below.',
    'Do NOT just list them. Reason across sources:',
    '- Where do the stories/sources converge?',
    '- Where do they conflict or disagree?',
    '- What is claimed but NOT yet confirmed, or rests on a single thin source? Name it.',
    '- What connection spans multiple stories that no single story states?',
    '',
    'Output GitHub-flavored markdown with exactly these two sections:',
    '## Executive Summary',
    '(3-6 sentences of cross-source synthesis, flagging the unconfirmed/thin claims by name)',
    '## Key Themes',
    '(3-6 bullet points, one short theme each)',
    '',
    'STORIES:',
    ...blocks,
  ].join('\n');
  if (locale === 'zh-CN') {
    return base + '\n\nIMPORTANT: Write the entire response in Simplified Chinese (简体中文). Use these exact headings: ## 执行摘要, ## 关键主题. Do not include any thinking or process commentary.';
  }
  return base;
}

export async function generateSynthesisBriefing(): Promise<StoredBriefing | null> {
  const settings = getServerAISettings();
  if (!settings.enabled) return null;

  const stories = getRankedStories(TOP_STORY_COUNT);
  if (stories.length === 0) return null;

  const blocks = stories.map((s) => {
    const detail = getStoryDetail(s.id);
    const events = (detail?.events ?? []).slice(0, EVENTS_PER_STORY).map((e) => `  - ${e.summary}`);
    return [
      `STORY: ${s.title}`,
      `STATUS: ${s.status} (${s.articleCount} sources)`,
      `SUMMARY: ${s.summary ?? '(none)'}`,
      'DEVELOPMENTS:',
      ...events,
    ].join('\n');
  });

  const locale = settings.provider ? 'en' : 'en'; // locale handled below from AI settings language
  const prompt = buildPrompt(blocks, (settings as { language?: string }).language === 'zh-CN' ? 'zh-CN' : 'en');

  let text: string;
  try {
    const response = await generateText(settings.provider, prompt, {
      model: settings.model,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      temperature: 0.3,
      numCtx: Math.min(8192, computeNumCtx(prompt) + 1536),
    });
    text = stripThinking(response.text);
  } catch (error) {
    console.error('[synthesis] generation failed:', error);
    return null;
  }

  if (!text.trim()) return null;

  const briefingDate = new Date().toISOString().slice(0, 10);
  const titleDate = briefingDate;
  return saveBriefing({
    briefingDate,
    title: locale === 'zh-CN' ? `综合简报 — ${titleDate}` : `Synthesis — ${titleDate}`,
    executiveSummary: text,
    keyThemes: parseKeyThemes(text),
    topStories: stories.map((s) => ({
      articleId: s.id,
      title: s.title,
      url: '',
      sourceTitle: `${s.articleCount} sources`,
      category: s.status,
    })),
    modelProvider: settings.provider,
    modelName: settings.model,
  });
}
```

> NOTE: the locale wiring above is sloppy — fix it cleanly in implementation: read the language from settings. `getServerAISettings()` currently returns `{ enabled, provider, model, baseUrl, apiKey, embedModel }` and does NOT include `language`. Before implementing, check `lib/server/settings-repository.ts`: the persisted `aiSettings.language` exists (values like `'Original Language'`/a language name) and the briefing locale in the existing generate route was derived from `aiSettings.language`. Either (a) extend `getServerAISettings()` to also return `language`, or (b) read `getPersistedSettings(getDefaultSettingsSnapshot()).aiSettings.language` directly in this module. Pick one, set `const locale = <that> === 'zh-CN' || /chinese|简/i.test(<that>) ? 'zh-CN' : 'en'`, and use `locale` for BOTH `buildPrompt` and the title. Remove the placeholder `settings.provider ? 'en' : 'en'` line. The test does not exercise zh-CN, so keep the default 'en' path working.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/server/briefing-synthesis.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/briefing-synthesis.ts lib/server/briefing-synthesis.test.ts
git commit -m "feat: cross-source story synthesis briefing generator"
```

---

## Task 3: Latest-briefing API route

**Files:**
- Create: `app/api/briefings/latest/route.ts`

- [ ] **Step 1: Implement**

Create `app/api/briefings/latest/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getLatestBriefing } from '@/lib/server/briefings-repository';

export async function GET() {
  const briefing = getLatestBriefing();
  return NextResponse.json({ briefing });
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit -p tsconfig.json` — no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/briefings/latest/route.ts
git commit -m "feat: latest-briefing API route"
```

---

## Task 4: Repurpose the manual generate route to story synthesis

**Files:**
- Modify: `app/api/briefings/generate/route.ts`

> Replace the article-based logic with a call to the new server-side synthesis. The route becomes a thin manual trigger (no `aiSettings` in the body — settings come from the server).

- [ ] **Step 1: Read the current route**

Run: `sed -n '1,40p' app/api/briefings/generate/route.ts` to see imports and the handler signature.

- [ ] **Step 2: Replace the file contents**

Overwrite `app/api/briefings/generate/route.ts` with:

```ts
import { NextResponse } from 'next/server';
import { generateSynthesisBriefing } from '@/lib/server/briefing-synthesis';

export async function POST() {
  try {
    const briefing = await generateSynthesisBriefing();
    if (!briefing) {
      return NextResponse.json(
        { error: 'No briefing generated. Ensure AI is enabled and stories exist.' },
        { status: 422 },
      );
    }
    return NextResponse.json({ briefing });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate briefing' },
      { status: 500 },
    );
  }
}
```

> If any client currently POSTs `aiSettings` to this route and reads the old response shape, that's fine — the response still returns `{ briefing }` (a `StoredBriefing`). Check `components/BriefingManager.tsx` / `components/BriefingsWorkspace.tsx` for how they call `/api/briefings/generate` and what they expect back; if they read `data.briefing`, no change needed. If they read a different field, note it as a follow-up (do not expand scope here unless it breaks the build).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit -p tsconfig.json` — no new errors. Then `npm run build` to ensure the route compiles and no dead imports remain.

- [ ] **Step 4: Commit**

```bash
git add app/api/briefings/generate/route.ts
git commit -m "feat: repurpose /api/briefings/generate to story synthesis"
```

---

## Task 5: Daily synthesis scheduling on the worker

**Files:**
- Modify: `lib/server/background-worker.ts`

> Add a once-per-day gate using `briefingSettings.times` (earliest configured time) + `briefingSettings.lastGenerated`. On generation, persist `lastGenerated` via `savePersistedSettings`.

- [ ] **Step 1: Read the worker structure**

Run: `grep -n "function tick\|runFeedRefreshIfDue\|startBackgroundWorker\|setInterval\|getPersistedSettings\|getDefaultSettingsSnapshot" lib/server/background-worker.ts` to find `tick` and existing settings imports (`getPersistedSettings`, `getDefaultSettingsSnapshot` are already imported in this file).

- [ ] **Step 2: Add the scheduling function**

In `lib/server/background-worker.ts`, add `savePersistedSettings` to the existing settings-repository import. Then add this function (near `runFeedRefreshIfDue`):

```ts
function isSynthesisDue(times: string[], lastGenerated: string | null, now: Date): boolean {
  if (!times || times.length === 0) return false;
  const today = now.toISOString().slice(0, 10);
  if (lastGenerated && lastGenerated.slice(0, 10) >= today) return false; // already generated today
  const nowHm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const earliest = [...times].sort()[0];
  return nowHm >= earliest;
}

async function runDailySynthesisIfDue(): Promise<void> {
  const settings = getPersistedSettings(getDefaultSettingsSnapshot());
  const bs = settings.briefingSettings;
  if (!bs?.enabled) return;
  if (!isSynthesisDue(bs.times ?? [], bs.lastGenerated ?? null, new Date())) return;

  try {
    const { generateSynthesisBriefing } = await import('./briefing-synthesis');
    const briefing = await generateSynthesisBriefing();
    if (briefing) {
      savePersistedSettings({
        ...settings,
        briefingSettings: { ...bs, lastGenerated: new Date().toISOString() },
      });
      console.log(`[IntelliDeck worker] Generated synthesis briefing "${briefing.title}".`);
    }
  } catch (error) {
    console.error('[IntelliDeck worker] synthesis briefing failed:', error);
  }
}
```

- [ ] **Step 3: Call it from the tick**

Find the `tick` function (the one passed to `setInterval`). It currently calls `runFeedRefreshIfDue(state)`. Immediately after that call, add:

```ts
    await runDailySynthesisIfDue();
```

(Match the existing `tick` body's async/await style. If `tick` calls `void runFeedRefreshIfDue(state)` without awaiting, use `void runDailySynthesisIfDue();` instead — match the surrounding pattern. Read the function first.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p tsconfig.json` — no new errors. `npm test` — all pass (no direct test for the worker; covered by Task 2's generator test).

- [ ] **Step 5: Commit**

```bash
git add lib/server/background-worker.ts
git commit -m "feat: schedule daily synthesis briefing on the worker tick"
```

---

## Task 6: BriefingCard component

**Files:**
- Create: `components/ui/BriefingCard.tsx`
- Modify: `lib/i18n/en.json`, `lib/i18n/zh-CN.json`

> Fetches `/api/briefings/latest`, renders a pinned card with the title + executive summary (collapsed to a few lines, expandable). Uses repo class conventions and `useTranslation` from `@/lib/i18n`. No unit test (presentational); verify via typecheck.

- [ ] **Step 1: Add i18n strings**

In `lib/i18n/en.json`, add a top-level `"briefing"` block (near the `"story"` block):

```json
"briefing": {
  "title": "Daily Briefing",
  "expand": "Read full briefing",
  "collapse": "Collapse",
  "none": "No briefing yet — it generates each morning from your stories.",
  "generate": "Generate now",
  "generating": "Generating…"
}
```

In `lib/i18n/zh-CN.json`, add:

```json
"briefing": {
  "title": "每日简报",
  "expand": "阅读完整简报",
  "collapse": "收起",
  "none": "暂无简报——每天早晨会根据你的故事自动生成。",
  "generate": "立即生成",
  "generating": "正在生成…"
}
```

- [ ] **Step 2: Create the component**

Create `components/ui/BriefingCard.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { RelativeTime } from '@/components/ui/RelativeTime';

interface LatestBriefing {
  id: string;
  title: string;
  executiveSummary: string;
  keyThemes: string[];
  briefingDate: string;
  createdAt: string;
}

export function BriefingCard() {
  const { t } = useTranslation();
  const [briefing, setBriefing] = useState<LatestBriefing | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = () => {
    fetch('/api/briefings/latest', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setBriefing(d.briefing ?? null))
      .catch(() => setBriefing(null))
      .finally(() => setLoaded(true));
  };

  useEffect(load, []);

  const generate = () => {
    setGenerating(true);
    fetch('/api/briefings/generate', { method: 'POST' })
      .then((r) => r.json())
      .then((d) => { if (d.briefing) { setBriefing(d.briefing); setExpanded(true); } })
      .catch(() => {})
      .finally(() => setGenerating(false));
  };

  if (!loaded) return null;

  if (!briefing) {
    return (
      <div className="rounded-lg border border-border bg-card p-3 text-foreground">
        <div className="text-[11px] uppercase tracking-wide opacity-60">{t('briefing.title')}</div>
        <p className="mt-1 text-sm opacity-70">{t('briefing.none')}</p>
        <button type="button" onClick={generate} disabled={generating} className="mt-2 text-sm text-accent hover:underline disabled:opacity-50">
          {generating ? t('briefing.generating') : t('briefing.generate')}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-accent/40 bg-card p-3 text-foreground">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wide text-accent">{t('briefing.title')}</div>
        <RelativeTime date={briefing.createdAt} className="text-[11px] opacity-50" />
      </div>
      <h3 className="mt-1 font-semibold leading-snug">{briefing.title}</h3>
      <div className={`mt-1 whitespace-pre-wrap text-sm opacity-80 ${expanded ? '' : 'line-clamp-4'}`}>
        {briefing.executiveSummary}
      </div>
      <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 text-sm text-accent hover:underline">
        {expanded ? t('briefing.collapse') : t('briefing.expand')}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

`node -e "JSON.parse(require('fs').readFileSync('lib/i18n/en.json'));JSON.parse(require('fs').readFileSync('lib/i18n/zh-CN.json'));console.log('json ok')"` and `npx tsc --noEmit -p tsconfig.json` (no new errors).

- [ ] **Step 4: Commit**

```bash
git add components/ui/BriefingCard.tsx lib/i18n/en.json lib/i18n/zh-CN.json
git commit -m "feat: pinned BriefingCard component"
```

---

## Task 7: Pin BriefingCard at the top of Today

**Files:**
- Modify: `components/StoriesFeed.tsx`

> The Today screen renders `StoriesFeed` (Phase 2). Render `BriefingCard` once at the top of the feed, above the story list.

- [ ] **Step 1: Read the current StoriesFeed**

Run: `cat components/StoriesFeed.tsx` to see its returned JSX (it has an empty-state branch and a main list branch).

- [ ] **Step 2: Add the pinned card**

In `components/StoriesFeed.tsx`:
- Add the import: `import { BriefingCard } from '@/components/ui/BriefingCard';`
- In the MAIN return (the one with the scrollable list `<div className="space-y-2 p-3 overflow-y-auto h-full">`), add `<BriefingCard />` as the FIRST child, before the `{stories.map(...)}`.
- In the empty-state branch (`stories.length === 0`), wrap so the BriefingCard still shows above the empty message:

```tsx
  if (loaded && stories.length === 0) {
    return (
      <div className="space-y-2 p-3 overflow-y-auto h-full">
        <BriefingCard />
        <div className="text-sm text-foreground opacity-60">{t('story.noStories')}</div>
      </div>
    );
  }
```

And the main return becomes:

```tsx
  return (
    <div className="space-y-2 p-3 overflow-y-auto h-full">
      <BriefingCard />
      {stories.map((story) => (
        <StoryCard
          key={story.id}
          story={story}
          events={selectedId === story.id ? events : undefined}
          expanded={selectedId === story.id}
          onToggle={select}
          onResearch={onResearch}
        />
      ))}
    </div>
  );
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit -p tsconfig.json` — no new errors.

- [ ] **Step 4: Commit**

```bash
git add components/StoriesFeed.tsx
git commit -m "feat: pin daily BriefingCard atop the Today stories feed"
```

---

## Task 8: Full suite + build + live smoke

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all pass, including the new `briefings-repository` and `briefing-synthesis` suites.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: compiles; routes `/api/briefings/latest` and `/api/briefings/generate` present.

- [ ] **Step 3: Live smoke (preview workflow, AI enabled, stories present)**

1. Start the dev server with Ollama reachable (`gemma4:12b-mlx`).
2. Ensure some stories exist (`SELECT COUNT(*) FROM stories;`); if not, reprocess a batch first.
3. `POST /api/briefings/generate` → expect `{ briefing: {...} }` whose `executiveSummary` reasons across stories (convergence/conflict/unconfirmed), not a flat list.
4. `GET /api/briefings/latest` → returns it.
5. On `/`, confirm the `BriefingCard` is pinned at the top of the Stories feed, expands, and the archive (`/briefings`) lists it. Screenshot for the user.

- [ ] **Step 4: Final commit (if any fixes)**

```bash
git add -A
git commit -m "test: phase-3 synthesis briefings integration sanity"
```

---

## Self-Review notes (for the implementer)

- **Locale handling (Task 2)** is the one rough edge: resolve `aiSettings.language` cleanly (extend `getServerAISettings` to include `language`, or read persisted settings directly) and use one `locale` value for both prompt and title. Remove the placeholder line. Don't break the default-English test.
- **`saveBriefing` topStories shape:** stories are mapped into the article-shaped `topStories` (articleId = story id, url = ''). The archive UI (`BriefingsWorkspace`) renders these — confirm it tolerates an empty `url` (render as non-link or skip the anchor). If it hard-requires a URL, point it at `''`→ no anchor, or `#`. Keep it minimal.
- **Manual route contract (Task 4):** confirm `BriefingManager`/`BriefingsWorkspace` read `data.briefing` from `/api/briefings/generate` and don't send a now-ignored body that breaks. The route ignores the body, which is safe.
- **Scheduling cadence:** `runDailySynthesisIfDue` runs on every worker tick but is a cheap no-op once `lastGenerated` is today. The worker tick interval is ~60s; generation only fires once/day after the earliest configured `briefingSettings.times` entry.
- **Today summary vs synthesis:** the lightweight "today summary" (`getLatestTodaySummary`, title `Summary %`) is separate and untouched; the pinned `BriefingCard` uses `getLatestBriefing` (any latest, which will be the synthesis). No conflict.
