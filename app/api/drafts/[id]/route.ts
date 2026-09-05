import { NextRequest, NextResponse } from 'next/server';
import { updateDraft, deleteDraft, isValidDraftStatus, type DraftStatus } from '@/lib/server/drafts-repository';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const patch: { draft?: string; status?: DraftStatus } = {};
  if (typeof body.draft === 'string') patch.draft = body.draft;
  if (isValidDraftStatus(body.status)) patch.status = body.status;
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
