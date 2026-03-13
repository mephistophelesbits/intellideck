import { NextRequest, NextResponse } from 'next/server';
import { runArticleSearch } from '@/lib/server/search-repository';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { query?: string };
    const query = body.query?.trim() ?? '';

    if (!query) {
      return NextResponse.json({ error: 'Missing query' }, { status: 400 });
    }

    return NextResponse.json(runArticleSearch(query));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to search articles' },
      { status: 500 },
    );
  }
}
