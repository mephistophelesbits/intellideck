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
