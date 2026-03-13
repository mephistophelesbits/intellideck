import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // Get feeds from URL params (passed from frontend via URL)
  // Format: ?feeds=[{"name":"Feed Name","url":"https://feed.url"},{"name":"Feed2","url":"https://feed2.url"}]
  
  const { searchParams } = new URL(request.url);
  const feedsParam = searchParams.get('feeds');
  
  if (!feedsParam) {
    return NextResponse.json({ error: 'No feeds provided' }, { status: 400 });
  }
  
  try {
    const feeds = JSON.parse(decodeURIComponent(feedsParam));
    
    // Generate OPML
    const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>RSS Deck - Exported Feeds</title>
  </head>
  <body>
${feeds.map((feed: any) => `    <outline text="${feed.name}" title="${feed.name}" type="rss" xmlUrl="${feed.url}" htmlUrl=""/>`).join('\n')}
  </body>
</opml>`;
    
    return new NextResponse(opml, {
      headers: {
        'Content-Type': 'application/xml',
        'Content-Disposition': 'attachment; filename="rssdeck-feeds.opml"',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Invalid feeds format' }, { status: 400 });
  }
}
