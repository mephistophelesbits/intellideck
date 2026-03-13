import { NextRequest, NextResponse } from 'next/server';
import { createColumn } from '@/lib/server/deck-repository';
import { Column } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const column = (await request.json()) as Column;

    if (!column?.id || !column?.title) {
      return NextResponse.json({ error: 'Invalid column payload' }, { status: 400 });
    }

    return NextResponse.json(createColumn(column));
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create column' },
      { status: 500 }
    );
  }
}
