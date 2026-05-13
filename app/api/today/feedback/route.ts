import { NextResponse } from 'next/server';
import { saveArticleFeedback } from '@/lib/server/preferences-repository';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const articleId = typeof body.articleId === 'string' ? body.articleId.trim() : '';
    const value = body.value === 1 || body.value === -1 || body.value === 0 ? body.value : null;

    if (!articleId || value === null) {
      return NextResponse.json({ error: 'Missing articleId or feedback value' }, { status: 400 });
    }

    return NextResponse.json(saveArticleFeedback(articleId, value));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save feedback' },
      { status: 500 }
    );
  }
}
