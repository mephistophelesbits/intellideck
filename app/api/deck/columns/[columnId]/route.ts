import { NextRequest, NextResponse } from 'next/server';
import { deleteColumn, updateColumn } from '@/lib/server/deck-repository';
import { Column } from '@/lib/types';

type RouteContext = {
  params: Promise<{ columnId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { columnId } = await context.params;
    const updates = (await request.json()) as Partial<Column>;
    return NextResponse.json(updateColumn(columnId, updates));
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update column' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { columnId } = await context.params;
    return NextResponse.json(deleteColumn(columnId));
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete column' },
      { status: 500 }
    );
  }
}
