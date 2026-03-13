import { NextRequest, NextResponse } from 'next/server';
import { addFeedToColumn } from '@/lib/server/deck-repository';
import { FeedSource } from '@/lib/types';

type RouteContext = {
  params: Promise<{ columnId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { columnId } = await context.params;
    const feed = (await request.json()) as FeedSource;

    if (!feed?.id || !feed?.url || !feed?.title) {
      return NextResponse.json({ error: 'Invalid feed payload' }, { status: 400 });
    }

    return NextResponse.json(addFeedToColumn(columnId, feed));
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add feed to column' },
      { status: 500 }
    );
  }
}
