import { NextRequest, NextResponse } from 'next/server';
import { getAllReadIds, markRead, markAllRead } from '@/lib/server/read-articles-repository';

export async function GET() {
  return NextResponse.json({ readIds: getAllReadIds() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { articleId?: string; articleIds?: string[] };

    if (body.articleIds) {
      markAllRead(body.articleIds);
    } else if (body.articleId) {
      markRead(body.articleId);
    } else {
      return NextResponse.json({ error: 'Missing articleId or articleIds' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Request failed' },
      { status: 500 },
    );
  }
}
