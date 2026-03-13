import { NextRequest, NextResponse } from 'next/server';
import { refreshSavedFeeds } from '@/lib/server/rss-ingestion';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = Number(body.limit);
    const result = await refreshSavedFeeds(Number.isFinite(limit) && limit > 0 ? limit : undefined);
    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to refresh saved feeds' },
      { status: 500 }
    );
  }
}
