import { NextRequest, NextResponse } from 'next/server';
import { JSDOM } from 'jsdom';

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }

    const host = parsedUrl.hostname.replace(/^www\./, '');
    if (host !== 'twitter.com' && host !== 'x.com') {
      return NextResponse.json({ error: 'Not a Twitter/X URL' }, { status: 400 });
    }

    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let oembedData: { html: string; author_name: string; author_url: string };
    try {
      const response = await fetch(oembedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return NextResponse.json(
          { error: `Tweet not found or unavailable (${response.status})` },
          { status: response.status === 404 ? 404 : 502 }
        );
      }

      oembedData = await response.json();
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        return NextResponse.json({ error: 'Request timed out' }, { status: 504 });
      }
      throw fetchError;
    }

    // Extract plain text and linked content from the blockquote
    const dom = new JSDOM(oembedData.html);
    const blockquote = dom.window.document.querySelector('blockquote');
    const tweetPara = blockquote?.querySelector('p');
    const tweetText = tweetPara?.textContent?.trim() ?? '';
    // Keep the inner HTML of the <p> for richer display (links preserved)
    const tweetHtml = tweetPara?.innerHTML ?? tweetText;

    const authorHandle = oembedData.author_url.split('/').pop() ?? '';
    const displayContent = `<blockquote style="border-left:4px solid #1d9bf0;padding:0 1em;margin:0"><p>${tweetHtml}</p><footer>— <a href="${oembedData.author_url}" target="_blank" rel="noopener noreferrer">${oembedData.author_name} (@${authorHandle})</a></footer></blockquote>`;

    return NextResponse.json({
      success: true,
      tweet: {
        title: `${oembedData.author_name} on Twitter`,
        content: displayContent,
        textContent: tweetText,
        excerpt: tweetText.slice(0, 200),
        byline: `${oembedData.author_name} (@${authorHandle})`,
        siteName: 'Twitter / X',
        length: tweetText.length,
      },
    });
  } catch (error: any) {
    console.error('Tweet fetch error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch tweet' }, { status: 500 });
  }
}
