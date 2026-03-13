import { NextRequest, NextResponse } from 'next/server';
import { ingestFeed } from '@/lib/server/rss-ingestion';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json(
      { error: 'Missing URL parameter' },
      { status: 400 }
    );
  }

  try {
    const result = await ingestFeed(url);
    if (!result.response) {
      throw new Error(result.error || 'Failed to fetch or parse RSS feed');
    }
    return NextResponse.json(result.response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch or parse RSS feed';
    console.error('RSS fetch error:', error);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
