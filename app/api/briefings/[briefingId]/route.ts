import { NextRequest, NextResponse } from 'next/server';
import { deleteBriefingById, getBriefingById } from '@/lib/server/briefings-repository';

type RouteContext = {
  params: Promise<{ briefingId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { briefingId } = await context.params;
  const briefing = getBriefingById(briefingId);

  if (!briefing) {
    return NextResponse.json({ error: 'Briefing not found' }, { status: 404 });
  }

  return NextResponse.json(briefing);
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { briefingId } = await context.params;
  const deleted = deleteBriefingById(briefingId);

  if (!deleted) {
    return NextResponse.json({ error: 'Briefing not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
