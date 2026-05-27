import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/server/db';

type ArticleContentRow = {
  id: string;
  canonical_url: string;
  raw_content: string | null;
  scraped_html: string | null;
  scraped_text: string | null;
  content_snippet: string | null;
};

export async function GET(request: NextRequest) {
  const articleId = request.nextUrl.searchParams.get('articleId');
  if (!articleId) {
    return NextResponse.json({ error: 'articleId is required' }, { status: 400 });
  }

  const row = getDb().prepare(`
    SELECT id, canonical_url, raw_content, scraped_html, scraped_text, content_snippet
    FROM articles
    WHERE id = ? OR canonical_url = ?
    LIMIT 1
  `).get(articleId, articleId) as ArticleContentRow | undefined;

  if (!row) {
    return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    url: row.canonical_url,
    content: row.scraped_html || row.raw_content || null,
    textContent: row.scraped_text || row.content_snippet || null,
    contentSnippet: row.content_snippet,
  });
}
