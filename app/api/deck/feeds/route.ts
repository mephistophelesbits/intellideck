import { NextRequest, NextResponse } from 'next/server';
import { saveFeed } from '@/lib/server/deck-repository';
import { FeedSource } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const feed = (await request.json()) as FeedSource;
    if (!feed?.id || !feed?.url || !feed?.title) {
      return NextResponse.json({ error: 'Invalid feed payload' }, { status: 400 });
    }

    return NextResponse.json(saveFeed(feed));
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save feed' },
      { status: 500 }
    );
  }
}
