import { NextRequest, NextResponse } from 'next/server';
import { getThemeDetail } from '@/lib/server/articles-repository';

type RouteContext = {
  params: Promise<{ theme: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { theme } = await context.params;
  const daysParam = request.nextUrl.searchParams.get('days');
  const days = daysParam ? Number(daysParam) : 7;
  const detail = getThemeDetail(decodeURIComponent(theme), Number.isFinite(days) ? days : 7);

  if (!detail) {
    return NextResponse.json({ error: 'Theme not found' }, { status: 404 });
  }

  return NextResponse.json(detail);
}
