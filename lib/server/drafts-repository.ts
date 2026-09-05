import 'server-only';

import { generateId } from '@/lib/utils';
import { getDb } from './db';

export type DraftStatus = 'draft' | 'edited' | 'published';

const DRAFT_STATUSES: readonly DraftStatus[] = ['draft', 'edited', 'published'];

export function isValidDraftStatus(value: unknown): value is DraftStatus {
  return DRAFT_STATUSES.includes(value as DraftStatus);
}

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
