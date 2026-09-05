import { NextResponse } from 'next/server';
import { getSearchRuleMonitoring } from '@/lib/server/search-repository';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const daysParam = Number(new URL(request.url).searchParams.get('days') ?? '7');
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 90) : 7;
    const groups = getSearchRuleMonitoring(days);
    return NextResponse.json({
      groups,
      meta: {
        days,
        totalGroups: groups.length,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load monitoring' },
      { status: 500 }
    );
  }
}
