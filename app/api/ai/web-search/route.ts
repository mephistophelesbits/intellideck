import { NextRequest, NextResponse } from 'next/server';
import { webSearch } from '@/lib/server/web-search';

export async function POST(req: NextRequest) {
  try {
    const { query, maxResults = 5 } = await req.json() as { query?: string; maxResults?: number };

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    const response = await webSearch(query, maxResults);
    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Web search error:', error);
    return NextResponse.json({ results: [], query: '', provider: 'none', error: error.message }, { status: 500 });
  }
}
