import { NextRequest, NextResponse } from 'next/server';
import { getTrendSeries } from '@/lib/server/articles-repository';

export async function GET(request: NextRequest) {
  const daysParam = request.nextUrl.searchParams.get('days');
  const lookbackParam = request.nextUrl.searchParams.get('lookbackDays');
  const days = daysParam ? Number(daysParam) : 7;
  const lookbackDays = lookbackParam ? Number(lookbackParam) : 14;

  return NextResponse.json(
    getTrendSeries(
      Number.isFinite(days) ? days : 7,
      Number.isFinite(lookbackDays) ? lookbackDays : 14
    )
  );
}
