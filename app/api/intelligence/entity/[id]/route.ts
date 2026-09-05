import { NextRequest, NextResponse } from 'next/server';
import { getEntityDetail } from '@/lib/server/entities-repository';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const detail = getEntityDetail(id);

  if (!detail) {
    return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
  }

  return NextResponse.json(detail);
}
