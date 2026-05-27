import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

type AmbientArticleRow = {
  id: string;
  canonical_url: string;
  title: string;
  published_at: string | null;
  created_at: string;
  source_title: string | null;
  source_url: string | null;
  content_snippet: string | null;
};

type FeedHealthRow = {
  total_feeds: number;
  successful_feeds: number | null;
  failed_feeds: number | null;
  refreshed_at: string | null;
};

function parsePublishedAt(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: NextRequest) {
  const limitParam = Number(request.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 240) : 160;
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      id,
      canonical_url,
      title,
      published_at,
      created_at,
      source_title,
      source_url,
      content_snippet
    FROM articles
    ORDER BY COALESCE(published_at, created_at) DESC, updated_at DESC
    LIMIT ?
  `).all(limit) as AmbientArticleRow[];

  const feedHealth = db.prepare(`
    SELECT
      COUNT(*) AS total_feeds,
      SUM(CASE WHEN last_error IS NULL OR last_error = '' THEN 1 ELSE 0 END) AS successful_feeds,
      SUM(CASE WHEN last_error IS NOT NULL AND last_error != '' THEN 1 ELSE 0 END) AS failed_feeds,
      MAX(last_fetched_at) AS refreshed_at
    FROM saved_feeds
  `).get() as FeedHealthRow;

  return NextResponse.json({
    items: rows
      .map((article) => ({
        id: article.id,
        title: article.title,
        url: article.canonical_url,
        originalPublishedAt: article.published_at,
        publishedAt: article.published_at || article.created_at,
        sourceTitle: article.source_title,
        sourceUrl: article.source_url,
        contentSnippet: article.content_snippet,
        content: null,
      }))
      .sort((a, b) => parsePublishedAt(b.publishedAt) - parsePublishedAt(a.publishedAt)),
    totalFeeds: feedHealth.total_feeds,
    successfulFeeds: feedHealth.successful_feeds ?? 0,
    failedFeeds: feedHealth.failed_feeds ?? 0,
    refreshedAt: feedHealth.refreshed_at ?? new Date().toISOString(),
  });
}
