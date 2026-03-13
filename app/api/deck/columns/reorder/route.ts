import { NextRequest, NextResponse } from 'next/server';
import { reorderColumns } from '@/lib/server/deck-repository';

export async function POST(request: NextRequest) {
  try {
    const { columnIds } = await request.json();
    if (!Array.isArray(columnIds)) {
      return NextResponse.json({ error: 'columnIds must be an array' }, { status: 400 });
    }

    return NextResponse.json(reorderColumns(columnIds));
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reorder columns' },
      { status: 500 }
    );
  }
}
