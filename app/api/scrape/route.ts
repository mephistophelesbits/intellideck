import { NextRequest, NextResponse } from 'next/server';
import { scrapeArticle } from '@/lib/server/article-scraper';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to scrape article';
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid URL' },
        { status: 400 }
      );
    }

    try {
      const article = await scrapeArticle(url);
      if (!article.textContent || article.textContent.length < 200) {
        return NextResponse.json(
          { error: 'Could not extract article content. The page may not be a standard article.' },
          { status: 422 }
        );
      }

      return NextResponse.json({
        success: true,
        article,
      });

    } catch (fetchError: unknown) {
      if (getErrorMessage(fetchError) === 'Request timed out') {
        return NextResponse.json(
          { error: 'Request timed out. The article page took too long to load.' },
          { status: 504 }
        );
      }

      throw fetchError;
    }

  } catch (error: unknown) {
    console.error('Scrape error:', error);

    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
