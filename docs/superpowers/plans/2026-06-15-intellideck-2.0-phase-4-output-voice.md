# IntelliDeck 2.0 — Phase 4: Output / Voice Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a story into a publishable **Xiaohongshu (XHS) draft in your voice** — pick a story, give an optional angle, generate a draft from the story's summary + timeline + a configurable voice profile, then edit / copy / mark published. The last 2.0 pillar.

**Architecture:** A voice profile (rules + few-shot examples of your real posts) is stored in app settings and edited in a new Settings "Voice" tab. A server `draft-generator` pulls the selected story (Phase 2 `getStoryDetail`) + the voice profile, builds a voice-conditioned prompt, calls the configured Ollama model, and returns draft text. Drafts persist in a new `content_drafts` table with a `draft → edited → published` status. The UI is a slide-in `DraftComposer` (same pattern as the Phase 2 `AgentDrawer`) summoned from a `StoryCard` "Draft" action.

**Decisions locked (from brainstorming):**
- **XHS only** this phase. The data model keeps a `platform` column and the voice-profile map is keyed by platform, so LinkedIn can be added later with no schema change — but do NOT build LinkedIn UI/profile now.
- **Voice profiles live in app settings**, edited in a Settings "Voice" tab (per-platform rules + few-shot example posts you paste).
- **Drafts are generated from the story** (title + summary + timeline) + voice profile + optional angle. Do NOT pull Agent Chat research into the draft prompt (deferred; the Agent drawer remains separate).

**Tech Stack:** `node:sqlite` + Ollama (`generateText` + `AIRequestOptions.numCtx`) + Next.js App Router + React (zustand settings store) + Vitest. Reuses: `getStoryDetail` ([lib/server/stories-repository.ts](../../../lib/server/stories-repository.ts)), `getServerAISettings` + `getPersistedSettings`/`getDefaultSettingsSnapshot` ([lib/server/settings-repository.ts](../../../lib/server/settings-repository.ts), [lib/settings-store.ts](../../../lib/settings-store.ts)), `generateText` ([lib/ai/providers.ts](../../../lib/ai/providers.ts)), `computeNumCtx` ([lib/ai/ollama-utils.ts](../../../lib/ai/ollama-utils.ts)), `generateId` ([lib/utils.ts](../../../lib/utils.ts)), the `AgentDrawer` slide-in pattern ([components/ui/AgentDrawer.tsx](../../../components/ui/AgentDrawer.tsx)) and the `onResearch` flow in `StoryCard`/`StoriesFeed`/`TodayWorkspace`.

**Default XHS voice profile (from the 2.0 spec):** rules = ["first person, warm with dry humor", "no em dashes", "under 1000 characters", "no generic AI-sounding phrases; sharp editorial sensibility", "lead with a concrete hook, not a thesis statement"]; fewShot = [] (you paste your real posts in Settings).

**Done when:** from a story on Today you can open the composer, generate an XHS draft in your voice, edit it, and save/mark it published — persisted across reloads.

---

## File Structure

**Create:**
- `lib/server/drafts-repository.ts` + `.test.ts` — `content_drafts` CRUD.
- `lib/server/draft-generator.ts` + `.test.ts` — story + voice profile → draft text.
- `app/api/drafts/generate/route.ts` — generate draft text.
- `app/api/drafts/route.ts` — POST (save), GET (list, optional `?sourceId=`).
- `app/api/drafts/[id]/route.ts` — PATCH (update draft text/status), DELETE.
- `components/ui/DraftComposer.tsx` — slide-in composer.

**Modify:**
- `lib/server/db.ts` — `content_drafts` table.
- `lib/settings-store.ts` — `voiceProfiles` in state + `SettingsSnapshot` + defaults + `toSettingsSnapshot` + `setVoiceProfiles` setter.
- `lib/server/settings-repository.ts` — `voiceProfiles` on `PersistedSettings` + `getVoiceProfile(platform)` helper.
- `components/ui/SettingsModal.tsx` — a "Voice" tab.
- `components/deck/StoryCard.tsx` — add an `onDraft` action.
- `components/StoriesFeed.tsx` — pass `onDraft` through.
- `components/TodayWorkspace.tsx` — mount `DraftComposer`, wire `onDraft`.
- `lib/i18n/en.json`, `lib/i18n/zh-CN.json` — voice + draft strings.

---

## Task 1: `content_drafts` schema

**Files:** Modify `lib/server/db.ts`.

- [ ] **Step 1: Add the table**

In `lib/server/db.ts`, inside the big `db.exec(\`...\`)` schema string, after the Phase 2 `story_reads` table block, add:

```sql
    CREATE TABLE IF NOT EXISTS content_drafts (
      id          TEXT PRIMARY KEY,
      source_type TEXT,
      source_id   TEXT,
      platform    TEXT NOT NULL,
      angle       TEXT,
      draft       TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'draft',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_content_drafts_source ON content_drafts(source_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_content_drafts_created ON content_drafts(created_at DESC);
```

- [ ] **Step 2: Verify SQL parses**

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const d = new DatabaseSync(':memory:');
d.exec(\`CREATE TABLE content_drafts (id TEXT PRIMARY KEY, source_type TEXT, source_id TEXT, platform TEXT NOT NULL, angle TEXT, draft TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX idx_content_drafts_source ON content_drafts(source_id, created_at DESC);\`);
console.log('schema OK');
"
```
Expected: `schema OK`.

- [ ] **Step 3: Commit**

```bash
git add lib/server/db.ts
git commit -m "feat: add content_drafts table"
```

---

## Task 2: Voice profiles in settings

**Files:**
- Modify: `lib/settings-store.ts`, `lib/server/settings-repository.ts`
- Test: `lib/server/settings-repository.voice.test.ts`

> Voice profiles are a platform-keyed map. Add to both the client store snapshot and the server `PersistedSettings` type, with a default XHS profile, plus a server `getVoiceProfile(platform)` helper.

- [ ] **Step 1: Extend the client store** (`lib/settings-store.ts`)

a) In the `SettingsState` interface, after the `briefingSettings` setter block (before `keywordAlerts`), add:
```ts
  voiceProfiles: Record<string, { rules: string[]; fewShot: string[] }>;
  setVoiceProfiles: (profiles: Record<string, { rules: string[]; fewShot: string[] }>) => void;
```
b) In the `SettingsSnapshot` Pick union, add `| 'voiceProfiles'`.
c) In `getDefaultSettingsSnapshot()` returned object, after `briefingSettings`, add:
```ts
    voiceProfiles: {
      xhs: {
        rules: [
          'first person, warm with dry humor',
          'no em dashes',
          'under 1000 characters',
          'no generic AI-sounding phrases; sharp editorial sensibility',
          'lead with a concrete hook, not a thesis statement',
        ],
        fewShot: [],
      },
    },
```
d) In `toSettingsSnapshot(state)`, add `voiceProfiles: state.voiceProfiles,`.
e) Find where the store is created (`create<SettingsState>()((set) => ({ ...getDefaultSettingsSnapshot(), ... }))`) and add the setter alongside the other `setX` setters:
```ts
  setVoiceProfiles: (voiceProfiles) => set((state) => {
    const next = { ...state, voiceProfiles };
    persistSettings(toSettingsSnapshot(next));
    return { voiceProfiles };
  }),
```
> Match the exact pattern of the existing `setBriefingSettings`/`setKeywordAlerts` setters (they call `persistSettings(toSettingsSnapshot(...))`). Read those first and mirror them precisely — if they merge partials differently, follow that.

- [ ] **Step 2: Extend the server type** (`lib/server/settings-repository.ts`)

In `PersistedSettings`, after `briefingSettings`, add:
```ts
  voiceProfiles?: Record<string, { rules: string[]; fewShot: string[] }>;
```
(Optional because older persisted rows won't have it; `getPersistedSettings` merges over defaults so reads are safe.)

- [ ] **Step 3: Write the failing test** — create `lib/server/settings-repository.voice.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/types', () => ({}));

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE app_settings (id TEXT PRIMARY KEY, settings_json TEXT NOT NULL, created_at TEXT, updated_at TEXT);`);
vi.mock('./db', () => ({ getDb: () => db }));

import { getVoiceProfile } from './settings-repository';

describe('getVoiceProfile', () => {
  it('returns the default XHS profile when nothing is persisted', () => {
    const p = getVoiceProfile('xhs');
    expect(p.rules).toContain('no em dashes');
    expect(Array.isArray(p.fewShot)).toBe(true);
  });

  it('returns an empty profile for an unknown platform', () => {
    const p = getVoiceProfile('linkedin');
    expect(p).toEqual({ rules: [], fewShot: [] });
  });

  it('returns the persisted profile when present', () => {
    const settings = { ...{}, voiceProfiles: { xhs: { rules: ['custom rule'], fewShot: ['my post'] } } };
    db.prepare("INSERT INTO app_settings (id, settings_json, created_at, updated_at) VALUES ('global', ?, 't', 't')")
      .run(JSON.stringify(settings));
    const p = getVoiceProfile('xhs');
    expect(p.rules).toEqual(['custom rule']);
    expect(p.fewShot).toEqual(['my post']);
  });
});
```

> The test mocks `@/lib/types` because `settings-repository.ts` imports `KeywordAlert` from it; the empty mock keeps the import resolvable. If that mock causes issues, instead let it resolve normally — try without the mock first and add it only if the import fails.

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run lib/server/settings-repository.voice.test.ts`
Expected: FAIL (`getVoiceProfile` not exported).

- [ ] **Step 5: Implement `getVoiceProfile`** in `lib/server/settings-repository.ts` (after `getServerAISettings`):

```ts
export interface VoiceProfile {
  rules: string[];
  fewShot: string[];
}

export function getVoiceProfile(platform: string): VoiceProfile {
  const settings = getPersistedSettings(getDefaultSettingsSnapshot());
  const profile = settings.voiceProfiles?.[platform];
  return {
    rules: profile?.rules ?? [],
    fewShot: profile?.fewShot ?? [],
  };
}
```
> `getServerAISettings` already imports `getPersistedSettings` and `getDefaultSettingsSnapshot` in this file — reuse them. Because `getDefaultSettingsSnapshot()` now includes the default XHS profile (Task 2 Step 1c) and `getPersistedSettings` spreads persisted over defaults, `getVoiceProfile('xhs')` returns the default when nothing is persisted, and an unknown platform falls through to `{ rules: [], fewShot: [] }`.

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run lib/server/settings-repository.voice.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.json` (no new errors).
```bash
git add lib/settings-store.ts lib/server/settings-repository.ts lib/server/settings-repository.voice.test.ts
git commit -m "feat: voice profiles in settings + getVoiceProfile helper"
```

---

## Task 3: Drafts repository (CRUD)

**Files:**
- Create: `lib/server/drafts-repository.ts`
- Test: `lib/server/drafts-repository.test.ts`

- [ ] **Step 1: Write the failing test** — create `lib/server/drafts-repository.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/utils', () => ({ generateId: () => 'd-' + Math.random().toString(36).slice(2, 8) }));

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE content_drafts (
  id TEXT PRIMARY KEY, source_type TEXT, source_id TEXT, platform TEXT NOT NULL, angle TEXT,
  draft TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
vi.mock('./db', () => ({ getDb: () => db }));

import { createDraft, getDrafts, getDraftById, updateDraft, deleteDraft } from './drafts-repository';

beforeEach(() => db.exec('DELETE FROM content_drafts'));

describe('drafts-repository', () => {
  it('creates and reads a draft', () => {
    const d = createDraft({ sourceType: 'story', sourceId: 's1', platform: 'xhs', angle: 'fun', draft: 'hello' });
    expect(d.id).toBeTruthy();
    expect(d.status).toBe('draft');
    expect(getDraftById(d.id)!.draft).toBe('hello');
  });

  it('lists drafts, newest first, optionally filtered by source', () => {
    createDraft({ sourceType: 'story', sourceId: 's1', platform: 'xhs', angle: null, draft: 'a' });
    createDraft({ sourceType: 'story', sourceId: 's2', platform: 'xhs', angle: null, draft: 'b' });
    expect(getDrafts().length).toBe(2);
    expect(getDrafts('s1').map((d) => d.draft)).toEqual(['a']);
  });

  it('updates draft text and status (and bumps updated_at)', () => {
    const d = createDraft({ sourceType: 'story', sourceId: 's1', platform: 'xhs', angle: null, draft: 'a' });
    const updated = updateDraft(d.id, { draft: 'edited', status: 'published' });
    expect(updated!.draft).toBe('edited');
    expect(updated!.status).toBe('published');
  });

  it('deletes a draft', () => {
    const d = createDraft({ sourceType: 'story', sourceId: 's1', platform: 'xhs', angle: null, draft: 'a' });
    expect(deleteDraft(d.id)).toBe(true);
    expect(getDraftById(d.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/server/drafts-repository.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — create `lib/server/drafts-repository.ts`:

```ts
import 'server-only';

import { generateId } from '@/lib/utils';
import { getDb } from './db';

export type DraftStatus = 'draft' | 'edited' | 'published';

export interface DraftRow {
  id: string;
  sourceType: string | null;
  sourceId: string | null;
  platform: string;
  angle: string | null;
  draft: string;
  status: DraftStatus;
  createdAt: string;
  updatedAt: string;
}

const SELECT = `
  SELECT id, source_type AS sourceType, source_id AS sourceId, platform, angle,
         draft, status, created_at AS createdAt, updated_at AS updatedAt
  FROM content_drafts
`;

export function createDraft(input: {
  sourceType: string | null;
  sourceId: string | null;
  platform: string;
  angle: string | null;
  draft: string;
  status?: DraftStatus;
}): DraftRow {
  const db = getDb();
  const id = generateId();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO content_drafts (id, source_type, source_id, platform, angle, draft, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.sourceType, input.sourceId, input.platform, input.angle, input.draft, input.status ?? 'draft', now, now);
  return getDraftById(id)!;
}

export function getDraftById(id: string): DraftRow | null {
  const db = getDb();
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as DraftRow | undefined;
  return row ?? null;
}

export function getDrafts(sourceId?: string): DraftRow[] {
  const db = getDb();
  if (sourceId) {
    return db.prepare(`${SELECT} WHERE source_id = ? ORDER BY created_at DESC`).all(sourceId) as DraftRow[];
  }
  return db.prepare(`${SELECT} ORDER BY created_at DESC`).all() as DraftRow[];
}

export function updateDraft(id: string, patch: { draft?: string; status?: DraftStatus }): DraftRow | null {
  const db = getDb();
  const existing = getDraftById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  db.prepare('UPDATE content_drafts SET draft = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(patch.draft ?? existing.draft, patch.status ?? existing.status, now, id);
  return getDraftById(id);
}

export function deleteDraft(id: string): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM content_drafts WHERE id = ?').run(id) as { changes: number };
  return res.changes > 0;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/server/drafts-repository.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/drafts-repository.ts lib/server/drafts-repository.test.ts
git commit -m "feat: content drafts repository (CRUD)"
```

---

## Task 4: Draft generator

**Files:**
- Create: `lib/server/draft-generator.ts`
- Test: `lib/server/draft-generator.test.ts`

> Pull the story (summary + timeline) + voice profile + angle → voice-conditioned prompt → LLM → draft text. Returns `null` on disabled / missing story / throw. Does NOT persist (the composer saves separately).

- [ ] **Step 1: Write the failing test** — create `lib/server/draft-generator.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const generateText = vi.fn();
vi.mock('@/lib/ai/providers', () => ({ generateText: (...a: unknown[]) => generateText(...a) }));

const getStoryDetail = vi.fn();
vi.mock('./stories-repository', () => ({ getStoryDetail: (...a: unknown[]) => getStoryDetail(...a) }));

let enabled = true;
vi.mock('./settings-repository', () => ({
  getServerAISettings: () => ({ enabled, provider: 'ollama', model: 'gemma4:12b-mlx', baseUrl: undefined, apiKey: undefined }),
  getVoiceProfile: () => ({ rules: ['no em dashes', 'warm with dry humor'], fewShot: ['Example real post here.'] }),
}));

import { generateDraft } from './draft-generator';

beforeEach(() => { vi.clearAllMocks(); enabled = true; });

describe('generateDraft', () => {
  it('returns null when AI is disabled', async () => {
    enabled = false;
    expect(await generateDraft({ sourceType: 'story', sourceId: 's1', platform: 'xhs', angle: null })).toBeNull();
    expect(generateText).not.toHaveBeenCalled();
  });

  it('returns null when the story is missing', async () => {
    getStoryDetail.mockReturnValue(null);
    expect(await generateDraft({ sourceType: 'story', sourceId: 'nope', platform: 'xhs', angle: null })).toBeNull();
  });

  it('builds a voice-conditioned prompt from the story and returns the draft text', async () => {
    getStoryDetail.mockReturnValue({
      story: { title: 'Chip export controls', summary: 'A policy story.' },
      events: [{ summary: 'New license rules' }, { summary: 'Revenue impact' }],
    });
    generateText.mockResolvedValue({ text: '  Here is my XHS post.  ' });

    const result = await generateDraft({ sourceType: 'story', sourceId: 's1', platform: 'xhs', angle: 'make it punchy' });

    const prompt = generateText.mock.calls[0][1] as string;
    expect(prompt).toContain('Chip export controls');     // story title
    expect(prompt).toContain('New license rules');         // timeline
    expect(prompt).toContain('no em dashes');              // voice rule
    expect(prompt).toContain('Example real post here.');   // few-shot
    expect(prompt).toContain('make it punchy');            // angle
    expect(result).toBe('Here is my XHS post.');           // trimmed
  });

  it('returns null when the model throws', async () => {
    getStoryDetail.mockReturnValue({ story: { title: 'X', summary: 's' }, events: [] });
    generateText.mockRejectedValue(new Error('down'));
    expect(await generateDraft({ sourceType: 'story', sourceId: 's1', platform: 'xhs', angle: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/server/draft-generator.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — create `lib/server/draft-generator.ts`:

```ts
import 'server-only';

import { generateText } from '@/lib/ai/providers';
import { computeNumCtx } from '@/lib/ai/ollama-utils';
import { getServerAISettings, getVoiceProfile } from './settings-repository';
import { getStoryDetail } from './stories-repository';

export interface GenerateDraftInput {
  sourceType: 'story';
  sourceId: string;
  platform: string;
  angle: string | null;
}

const PLATFORM_LABEL: Record<string, string> = { xhs: 'Xiaohongshu (RED)' };

function buildPrompt(opts: {
  platform: string;
  rules: string[];
  fewShot: string[];
  title: string;
  summary: string;
  timeline: string[];
  angle: string | null;
}): string {
  const lines = [
    `Write a ${PLATFORM_LABEL[opts.platform] ?? opts.platform} post in MY voice about the story below.`,
    'Output ONLY the post text — no preamble, no explanation, no markdown headings.',
    '',
    'VOICE RULES:',
    ...opts.rules.map((r) => `- ${r}`),
  ];
  if (opts.fewShot.length > 0) {
    lines.push('', 'EXAMPLES OF MY REAL POSTS (match this voice, do not copy content):');
    opts.fewShot.forEach((ex, i) => lines.push(`--- Example ${i + 1} ---`, ex));
  }
  lines.push('', 'STORY:', `Title: ${opts.title}`, `Summary: ${opts.summary}`);
  if (opts.timeline.length > 0) {
    lines.push('Developments:', ...opts.timeline.map((t) => `- ${t}`));
  }
  if (opts.angle && opts.angle.trim()) {
    lines.push('', `ANGLE TO TAKE: ${opts.angle.trim()}`);
  }
  lines.push('', 'Now write the post:');
  return lines.join('\n');
}

export async function generateDraft(input: GenerateDraftInput): Promise<string | null> {
  const settings = getServerAISettings();
  if (!settings.enabled) return null;

  const detail = getStoryDetail(input.sourceId);
  if (!detail) return null;

  const voice = getVoiceProfile(input.platform);
  const prompt = buildPrompt({
    platform: input.platform,
    rules: voice.rules,
    fewShot: voice.fewShot,
    title: detail.story.title,
    summary: detail.story.summary ?? '',
    timeline: (detail.events ?? []).slice(0, 10).map((e) => e.summary),
    angle: input.angle,
  });

  try {
    const { text } = await generateText(settings.provider, prompt, {
      model: settings.model,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      temperature: 0.7,
      numCtx: Math.min(8192, computeNumCtx(prompt) + 1024),
    });
    const trimmed = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return trimmed || null;
  } catch (error) {
    console.error('[draft] generation failed:', error);
    return null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/server/draft-generator.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/server/draft-generator.ts lib/server/draft-generator.test.ts
git commit -m "feat: voice-conditioned draft generator"
```

---

## Task 5: Generate-draft API route

**Files:** Create `app/api/drafts/generate/route.ts`.

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from 'next/server';
import { generateDraft } from '@/lib/server/draft-generator';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId : '';
  const platform = typeof body.platform === 'string' ? body.platform : 'xhs';
  const angle = typeof body.angle === 'string' ? body.angle : null;
  if (!sourceId) {
    return NextResponse.json({ error: 'sourceId is required' }, { status: 400 });
  }

  const draft = await generateDraft({ sourceType: 'story', sourceId, platform, angle });
  if (draft === null) {
    return NextResponse.json(
      { error: 'No draft generated. Ensure AI is enabled and the story exists.' },
      { status: 422 },
    );
  }
  return NextResponse.json({ draft });
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit -p tsconfig.json` — no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/drafts/generate/route.ts
git commit -m "feat: generate-draft API route"
```

---

## Task 6: Drafts CRUD API routes

**Files:**
- Create: `app/api/drafts/route.ts`, `app/api/drafts/[id]/route.ts`

- [ ] **Step 1: List + create** — create `app/api/drafts/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createDraft, getDrafts, type DraftStatus } from '@/lib/server/drafts-repository';

export async function GET(request: Request) {
  const sourceId = new URL(request.url).searchParams.get('sourceId') ?? undefined;
  return NextResponse.json({ drafts: getDrafts(sourceId) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.draft !== 'string' || body.draft.trim() === '') {
    return NextResponse.json({ error: 'draft text is required' }, { status: 400 });
  }
  const draft = createDraft({
    sourceType: typeof body.sourceType === 'string' ? body.sourceType : 'story',
    sourceId: typeof body.sourceId === 'string' ? body.sourceId : null,
    platform: typeof body.platform === 'string' ? body.platform : 'xhs',
    angle: typeof body.angle === 'string' ? body.angle : null,
    draft: body.draft,
    status: (['draft', 'edited', 'published'] as DraftStatus[]).includes(body.status) ? body.status : 'draft',
  });
  return NextResponse.json({ draft });
}
```

- [ ] **Step 2: Update + delete** — create `app/api/drafts/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { updateDraft, deleteDraft, type DraftStatus } from '@/lib/server/drafts-repository';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const patch: { draft?: string; status?: DraftStatus } = {};
  if (typeof body.draft === 'string') patch.draft = body.draft;
  if ((['draft', 'edited', 'published'] as DraftStatus[]).includes(body.status)) patch.status = body.status;
  const updated = updateDraft(id, patch);
  if (!updated) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  return NextResponse.json({ draft: updated });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const ok = deleteDraft(id);
  if (!ok) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit -p tsconfig.json` — no new errors. `npm run build` — both `/api/drafts` and `/api/drafts/[id]` present.

- [ ] **Step 4: Commit**

```bash
git add app/api/drafts/route.ts "app/api/drafts/[id]/route.ts"
git commit -m "feat: drafts CRUD API routes"
```

---

## Task 7: Settings "Voice" tab

**Files:**
- Modify: `components/ui/SettingsModal.tsx`, `lib/i18n/en.json`, `lib/i18n/zh-CN.json`

> Add a "Voice" tab to the Settings modal that edits the XHS profile: rules (one per line) and few-shot examples (separated by a blank line / a delimiter). Reads/writes via the store `voiceProfiles` + `setVoiceProfiles`. **Read `components/ui/SettingsModal.tsx` first** to learn its tab mechanism (how the existing tabs — general, keyword alerts, data — are declared and switched) and follow that exact pattern.

- [ ] **Step 1: Add i18n strings**

In `lib/i18n/en.json`, add under the existing `settings` block (match its nested structure):
```json
"voice": {
  "tab": "Voice",
  "heading": "XHS Voice Profile",
  "description": "Define your voice for Xiaohongshu drafts.",
  "rulesLabel": "Voice rules (one per line)",
  "examplesLabel": "Example posts (separate each with a blank line)",
  "examplesHint": "Paste a few of your real published posts so drafts match your voice."
}
```
In `lib/i18n/zh-CN.json`, add the matching block:
```json
"voice": {
  "tab": "文风",
  "heading": "小红书文风档案",
  "description": "定义你的小红书草稿文风。",
  "rulesLabel": "文风规则（每行一条）",
  "examplesLabel": "示例帖子（每篇之间空一行）",
  "examplesHint": "粘贴几篇你真实发布过的帖子，让草稿贴近你的文风。"
}
```

- [ ] **Step 2: Add the tab**

In `components/ui/SettingsModal.tsx`:
- Pull `voiceProfiles` and `setVoiceProfiles` from the settings store (the component already consumes the store — add these to its destructuring / `useSettingsStore` selectors, matching how `briefingSettings`/`setBriefingSettings` are read).
- Register a new tab entry "voice" in whatever structure declares the tabs (label `t('settings.voice.tab')`), placed after the existing tabs.
- Render the tab panel when active. Use two textareas bound to the XHS profile, converting between array and text:
  - rules: `value={(voiceProfiles.xhs?.rules ?? []).join('\n')}`, on change split on `\n` (drop empty lines on save).
  - fewShot: `value={(voiceProfiles.xhs?.fewShot ?? []).join('\n\n')}`, on change split on `/\n\n+/` (drop empty).
  - On change call `setVoiceProfiles({ ...voiceProfiles, xhs: { rules, fewShot } })`.

Concrete panel body (adapt class names / wrappers to match the modal's existing tab panels):
```tsx
<div className="space-y-4">
  <div>
    <h3 className="text-sm font-semibold">{t('settings.voice.heading')}</h3>
    <p className="text-xs text-foreground-secondary mt-1">{t('settings.voice.description')}</p>
  </div>
  <label className="block">
    <span className="text-sm">{t('settings.voice.rulesLabel')}</span>
    <textarea
      className="mt-1 w-full h-28 rounded-lg border border-border bg-background p-2 text-sm"
      value={(voiceProfiles.xhs?.rules ?? []).join('\n')}
      onChange={(e) => setVoiceProfiles({
        ...voiceProfiles,
        xhs: { rules: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean), fewShot: voiceProfiles.xhs?.fewShot ?? [] },
      })}
    />
  </label>
  <label className="block">
    <span className="text-sm">{t('settings.voice.examplesLabel')}</span>
    <p className="text-xs text-foreground-secondary mt-0.5">{t('settings.voice.examplesHint')}</p>
    <textarea
      className="mt-1 w-full h-40 rounded-lg border border-border bg-background p-2 text-sm"
      value={(voiceProfiles.xhs?.fewShot ?? []).join('\n\n')}
      onChange={(e) => setVoiceProfiles({
        ...voiceProfiles,
        xhs: { rules: voiceProfiles.xhs?.rules ?? [], fewShot: e.target.value.split(/\n\n+/).map((s) => s.trim()).filter(Boolean) },
      })}
    />
  </label>
</div>
```

> If the modal's tab system is an array of `{ id, label }` + a `switch`/conditional on an `activeTab` state, add `'voice'` to that union/array and render the panel in the same place the others render. Match the file's conventions exactly; do not restructure the modal.

- [ ] **Step 3: Verify**

`node -e "JSON.parse(require('fs').readFileSync('lib/i18n/en.json'));JSON.parse(require('fs').readFileSync('lib/i18n/zh-CN.json'));console.log('json ok')"` and `npx tsc --noEmit -p tsconfig.json` (no new errors).

- [ ] **Step 4: Commit**

```bash
git add components/ui/SettingsModal.tsx lib/i18n/en.json lib/i18n/zh-CN.json
git commit -m "feat: Settings Voice tab for XHS voice profile"
```

---

## Task 8: DraftComposer component

**Files:**
- Create: `components/ui/DraftComposer.tsx`
- Modify: `lib/i18n/en.json`, `lib/i18n/zh-CN.json`

> A right-side slide-in (same visual pattern as `components/ui/AgentDrawer.tsx` — read it for the overlay/aside markup). Given a `storyId`, it: shows an angle input + Generate button → `POST /api/drafts/generate` → fills an editable textarea → Save (`POST /api/drafts`) → Copy → Mark published (`PATCH /api/drafts/[id]`).

- [ ] **Step 1: Add i18n strings**

In `lib/i18n/en.json`, add a top-level `"draft"` block (near `"briefing"`):
```json
"draft": {
  "title": "Draft a post",
  "anglePlaceholder": "Optional angle or hook…",
  "generate": "Generate draft",
  "generating": "Generating…",
  "regenerate": "Regenerate",
  "save": "Save draft",
  "saved": "Saved",
  "copy": "Copy",
  "copied": "Copied",
  "publish": "Mark published",
  "published": "Published",
  "empty": "Generate a draft, then edit it here.",
  "charCount": "{count} chars"
}
```
In `lib/i18n/zh-CN.json`:
```json
"draft": {
  "title": "撰写帖子",
  "anglePlaceholder": "可选的角度或切入点…",
  "generate": "生成草稿",
  "generating": "正在生成…",
  "regenerate": "重新生成",
  "save": "保存草稿",
  "saved": "已保存",
  "copy": "复制",
  "copied": "已复制",
  "publish": "标记为已发布",
  "published": "已发布",
  "empty": "先生成草稿，然后在此编辑。",
  "charCount": "{count} 字"
}
```

- [ ] **Step 2: Create the component** — `components/ui/DraftComposer.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n';

interface DraftComposerProps {
  open: boolean;
  storyId: string | null;
  onClose: () => void;
}

const PLATFORM = 'xhs';

export function DraftComposer({ open, storyId, onClose }: DraftComposerProps) {
  const { t } = useTranslation();
  const [angle, setAngle] = useState('');
  const [text, setText] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [savedAt, setSavedAt] = useState<'saved' | 'published' | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!storyId) return;
    setGenerating(true);
    setSavedAt(null);
    try {
      const res = await fetch('/api/drafts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: storyId, platform: PLATFORM, angle }),
      });
      const data = await res.json();
      if (res.ok && typeof data.draft === 'string') { setText(data.draft); setDraftId(null); }
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    if (!text.trim()) return;
    const res = await fetch('/api/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceType: 'story', sourceId: storyId, platform: PLATFORM, angle, draft: text, status: 'edited' }),
    });
    const data = await res.json();
    if (res.ok && data.draft) { setDraftId(data.draft.id); setSavedAt('saved'); }
  };

  const publish = async () => {
    if (!draftId) { await save(); }
    const id = draftId;
    if (!id) return;
    const res = await fetch(`/api/drafts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: text, status: 'published' }),
    });
    if (res.ok) setSavedAt('published');
  };

  const copy = async () => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden />}
      <aside
        className={`fixed right-0 top-0 z-50 h-full w-[460px] max-w-[92vw] border-l border-border bg-card shadow-xl
          transition-transform duration-200 flex flex-col ${open ? 'translate-x-0' : 'translate-x-full'}`}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-border p-3">
          <span className="text-sm font-medium text-foreground">{t('draft.title')}</span>
          <button type="button" onClick={onClose} className="text-foreground opacity-60 hover:opacity-100">✕</button>
        </div>

        <div className="flex flex-col gap-3 p-3 flex-1 overflow-y-auto text-foreground">
          <input
            type="text"
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
            placeholder={t('draft.anglePlaceholder')}
            className="w-full rounded-lg border border-border bg-background p-2 text-sm"
          />
          <button
            type="button"
            onClick={generate}
            disabled={generating || !storyId}
            className="self-start rounded-lg bg-accent/10 px-3 py-1.5 text-sm text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {generating ? t('draft.generating') : text ? t('draft.regenerate') : t('draft.generate')}
          </button>

          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setSavedAt(null); }}
            placeholder={t('draft.empty')}
            className="min-h-[260px] flex-1 w-full rounded-lg border border-border bg-background p-2 text-sm leading-relaxed"
          />
          <div className="text-[11px] opacity-50">{t('draft.charCount', { count: text.length })}</div>
        </div>

        <div className="flex items-center gap-2 border-t border-border p-3">
          <button type="button" onClick={save} disabled={!text.trim()} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50">
            {savedAt === 'saved' ? t('draft.saved') : t('draft.save')}
          </button>
          <button type="button" onClick={copy} disabled={!text.trim()} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50">
            {copied ? t('draft.copied') : t('draft.copy')}
          </button>
          <button type="button" onClick={publish} disabled={!text.trim()} className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50">
            {savedAt === 'published' ? t('draft.published') : t('draft.publish')}
          </button>
        </div>
      </aside>
    </>
  );
}
```

> Confirm `t()` supports `{count}` interpolation (it does — used by Phase 2 `StoryCard`). Confirm the accent-on-white button (`bg-accent text-white`) reads acceptably in this theme; if the repo uses a different "primary button" pattern, match it. Read `AgentDrawer.tsx` to keep the overlay/aside markup consistent.

- [ ] **Step 3: Verify**

`node -e "JSON.parse(require('fs').readFileSync('lib/i18n/en.json'));JSON.parse(require('fs').readFileSync('lib/i18n/zh-CN.json'));console.log('json ok')"` and `npx tsc --noEmit -p tsconfig.json` (no new errors).

- [ ] **Step 4: Commit**

```bash
git add components/ui/DraftComposer.tsx lib/i18n/en.json lib/i18n/zh-CN.json
git commit -m "feat: DraftComposer slide-in"
```

---

## Task 9: Wire the Draft action (StoryCard → StoriesFeed → Today)

**Files:**
- Modify: `components/deck/StoryCard.tsx`, `components/StoriesFeed.tsx`, `components/TodayWorkspace.tsx`

> Mirror the existing `onResearch` flow exactly. **Read all three files first.**

- [ ] **Step 1: StoryCard — add an `onDraft` action**

In `components/deck/StoryCard.tsx`:
- Add `onDraft?: (id: string) => void;` to `StoryCardProps`.
- In the expanded section, next to the existing `onResearch` button (`t('story.openAgent')`), add a sibling button (only when `onDraft` is provided):
```tsx
{onDraft && (
  <button type="button" onClick={() => onDraft(story.id)} className="ml-3 text-sm text-accent hover:underline">
    {t('story.draftPost')}
  </button>
)}
```
- Add the i18n key `story.draftPost` ("Draft a post" / "撰写帖子") to `lib/i18n/en.json` and `lib/i18n/zh-CN.json` under the existing `story` block.

- [ ] **Step 2: StoriesFeed — pass `onDraft` through**

In `components/StoriesFeed.tsx`:
- Add `onDraft?: (storyId: string) => void;` to `StoriesFeedProps`.
- Pass `onDraft={onDraft}` to each `<StoryCard ... />` (alongside the existing `onResearch={onResearch}`).

- [ ] **Step 3: TodayWorkspace — mount DraftComposer + wire**

In `components/TodayWorkspace.tsx`:
- Import `DraftComposer` from `@/components/ui/DraftComposer`.
- Add state: `const [draftStoryId, setDraftStoryId] = useState<string | null>(null);`
- Pass `onDraft={(id) => setDraftStoryId(id)}` to `<StoriesFeed ... />` (next to the existing `onResearch=...`).
- Mount once near the root (next to `AgentDrawer`):
```tsx
<DraftComposer open={draftStoryId !== null} storyId={draftStoryId} onClose={() => setDraftStoryId(null)} />
```

- [ ] **Step 4: Verify**

`node -e "JSON.parse(require('fs').readFileSync('lib/i18n/en.json'));JSON.parse(require('fs').readFileSync('lib/i18n/zh-CN.json'));console.log('json ok')"`, `npx tsc --noEmit -p tsconfig.json` (no new errors).

- [ ] **Step 5: Commit**

```bash
git add components/deck/StoryCard.tsx components/StoriesFeed.tsx components/TodayWorkspace.tsx lib/i18n/en.json lib/i18n/zh-CN.json
git commit -m "feat: Draft action on stories opens the DraftComposer"
```

---

## Task 10: Full suite + build + live smoke

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all pass, including new `settings-repository.voice`, `drafts-repository`, `draft-generator` suites.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: compiles; `/api/drafts`, `/api/drafts/[id]`, `/api/drafts/generate` present.

- [ ] **Step 3: Live smoke (preview workflow, AI enabled, a story present)**

1. Start the dev server with Ollama reachable (`gemma4:12b-mlx`); ensure at least one story exists.
2. In Settings → Voice, confirm the default XHS rules show; optionally paste an example post.
3. On `/`, expand a story → click "Draft a post" → the composer opens; enter an angle → Generate → an XHS-voiced draft appears (first person, no em dashes, under ~1000 chars).
4. Edit it; Save → `POST /api/drafts` persists (`SELECT COUNT(*) FROM content_drafts`); Mark published → status `published`.
5. Reload, generate again to confirm stability. Screenshot for the user.

- [ ] **Step 4: Final commit (if any fixes)**

```bash
git add -A
git commit -m "test: phase-4 output/voice integration sanity"
```

---

## Self-Review notes (for the implementer)

- **Two settings type definitions** (`SettingsState`/`SettingsSnapshot` in `lib/settings-store.ts` and `PersistedSettings` in `lib/server/settings-repository.ts`) must BOTH gain `voiceProfiles`, plus defaults + `toSettingsSnapshot` + the store setter. Missing any one breaks persistence or types. Mirror the `briefingSettings` plumbing exactly.
- **SettingsModal (Task 7)** is a large existing file — read its tab mechanism and follow it; render the panel where the other tab panels render. Don't restructure the modal.
- **`getVoiceProfile('xhs')` default** relies on `getDefaultSettingsSnapshot()` including the XHS profile and `getPersistedSettings` spreading persisted over defaults. Verify a fresh DB (no persisted settings) still yields the default rules.
- **DraftComposer button theme:** the `bg-accent text-white` publish button is a guess — match the repo's primary-button styling if one exists.
- **Drafts are not yet surfaced in a list UI** beyond the composer's own save/publish — listing saved drafts (e.g. a drafts archive) is intentionally out of scope; `GET /api/drafts` exists for a future drafts view. Don't build that view now (YAGNI).
- **`story.draftPost` i18n key** is added in Task 9 (used by StoryCard); the broader `draft.*` block is added in Task 8. Keep both.
