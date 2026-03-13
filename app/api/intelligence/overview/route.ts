import { NextRequest, NextResponse } from 'next/server';
import { getIntelligenceOverview } from '@/lib/server/articles-repository';

export async function GET(request: NextRequest) {
  const daysParam = request.nextUrl.searchParams.get('days');
  const days = daysParam ? Number(daysParam) : 7;
  return NextResponse.json(getIntelligenceOverview(Number.isFinite(days) ? days : 7));
}
