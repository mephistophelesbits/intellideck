import { NextResponse } from 'next/server';
import { getDeckState } from '@/lib/server/deck-repository';
import { generateOPML } from '@/lib/opml';

export async function GET() {
  const { savedFeeds } = getDeckState();
  const opml = generateOPML(
    savedFeeds.map((feed) => ({
      title: feed.title,
      url: feed.url,
    })),
    'IntelliDeck Feed Export'
  );

  return new NextResponse(opml, {
    headers: {
      'Content-Type': 'text/x-opml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="intellideck-feeds.opml"',
    },
  });
}
