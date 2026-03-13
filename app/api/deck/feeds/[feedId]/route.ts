import { NextRequest, NextResponse } from 'next/server';
import { deleteSavedFeed } from '@/lib/server/deck-repository';

type RouteContext = {
  params: Promise<{ feedId: string }>;
};

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { feedId } = await context.params;
    return NextResponse.json(deleteSavedFeed(feedId));
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete feed' },
      { status: 500 }
    );
  }
}
