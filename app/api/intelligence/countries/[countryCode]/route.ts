import { NextRequest, NextResponse } from 'next/server';
import { getCountryDetail } from '@/lib/server/articles-repository';

type RouteContext = {
  params: Promise<{ countryCode: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { countryCode } = await context.params;
  const daysParam = request.nextUrl.searchParams.get('days');
  const days = daysParam ? Number(daysParam) : 7;
  const detail = getCountryDetail(decodeURIComponent(countryCode).toUpperCase(), Number.isFinite(days) ? days : 7);

  if (!detail) {
    return NextResponse.json({ error: 'Country not found' }, { status: 404 });
  }

  return NextResponse.json(detail);
}
