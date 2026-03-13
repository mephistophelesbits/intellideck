import { NextResponse } from 'next/server';
import { getDeckState } from '@/lib/server/deck-repository';
import { generateOPML } from '@/lib/opml';

export async function GET() {
  const { savedFeeds } = getDeckState();
  const body = generateOPML(
    savedFeeds.map((feed) => ({
      title: feed.title,
      url: feed.url,
    })),
    'RSS Deck Feed Export'
  );

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/x-opml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="rssdeck-feeds.opml"',
    },
  });
}
