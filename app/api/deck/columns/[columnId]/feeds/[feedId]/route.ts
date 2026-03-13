import { NextRequest, NextResponse } from 'next/server';
import { removeFeedFromColumn, updateFeedInColumn } from '@/lib/server/deck-repository';
import { FeedSource } from '@/lib/types';

type RouteContext = {
  params: Promise<{ columnId: string; feedId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { columnId, feedId } = await context.params;
    const updates = (await request.json()) as Partial<FeedSource>;
    return NextResponse.json(updateFeedInColumn(columnId, feedId, updates));
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update feed' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { columnId, feedId } = await context.params;
    return NextResponse.json(removeFeedFromColumn(columnId, feedId));
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to remove feed' },
      { status: 500 }
    );
  }
}
