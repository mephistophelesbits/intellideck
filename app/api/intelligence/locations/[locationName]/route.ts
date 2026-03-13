import { NextRequest, NextResponse } from 'next/server';
import { getLocationDetail } from '@/lib/server/articles-repository';

type RouteContext = {
  params: Promise<{ locationName: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { locationName } = await context.params;
  const daysParam = request.nextUrl.searchParams.get('days');
  const days = daysParam ? Number(daysParam) : 7;
  const detail = getLocationDetail(decodeURIComponent(locationName), Number.isFinite(days) ? days : 7);

  if (!detail) {
    return NextResponse.json({ error: 'Location not found' }, { status: 404 });
  }

  return NextResponse.json(detail);
}
