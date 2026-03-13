import { NextRequest, NextResponse } from 'next/server';
import { reprocessStoredArticles } from '@/lib/server/articles-repository';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = Number(body.limit);
    const result = reprocessStoredArticles(Number.isFinite(limit) && limit > 0 ? limit : 500);
    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reprocess stored articles' },
      { status: 500 }
    );
  }
}
