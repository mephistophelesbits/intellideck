import { NextResponse } from 'next/server';
import { createDraft, getDrafts, isValidDraftStatus } from '@/lib/server/drafts-repository';

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
    status: isValidDraftStatus(body.status) ? body.status : 'draft',
  });
  return NextResponse.json({ draft });
}
