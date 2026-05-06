import { NextRequest, NextResponse } from 'next/server';
import { ingestFeed } from '@/lib/server/rss-ingestion';
import { listSavedFeeds } from '@/lib/server/deck-repository';
import { Article } from '@/lib/types';

export const dynamic = 'force-dynamic';

type AmbientFeedItem = {
  id: string;
  title: string;
  url: string;
  originalPublishedAt: string | null;
  publishedAt: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  contentSnippet: string | null;
  content: string | null;
};

function parsePublishedAt(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  const normalized = value.replace(/(\d{2}:\d{2}:\d{2})\s+([+-]\d{4})$/, '$1 GMT$2');
  const normalizedParsed = Date.parse(normalized);
  return Number.isFinite(normalizedParsed) ? normalizedParsed : 0;
}

function extractTweetSnowflake(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/(?:status|statuses)\/(\d{15,25})|(?:^|[^\d])(\d{15,25})(?:$|[^\d])/);
  return match?.[1] || match?.[2] || null;
}

function dateFromTweetSnowflake(value: string | null | undefined) {
  const snowflake = extractTweetSnowflake(value);
  if (!snowflake) return null;

  try {
    const timestamp = (BigInt(snowflake) >> BigInt(22)) + BigInt('1288834974657');
    const millis = Number(timestamp);
    if (!Number.isFinite(millis)) return null;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

function isTweetish(article: Article, feedUrl: string) {
  const haystack = `${article.link} ${article.sourceUrl ?? ''} ${feedUrl} ${article.sourceTitle ?? ''}`.toLowerCase();
  return (
    haystack.includes('twitter.com') ||
    haystack.includes('x.com') ||
    haystack.includes('/tweets/') ||
    haystack.includes('tweet')
  );
}

function resolvePublishedAt(article: Article, feedUrl: string, fetchedAt: string | null) {
  const originalPublishedAt = article.pubDate || null;
  const snowflakeDate = dateFromTweetSnowflake(article.link) || dateFromTweetSnowflake(article.id);
  if (snowflakeDate) {
    return { originalPublishedAt, publishedAt: snowflakeDate };
  }

  const parsed = parsePublishedAt(originalPublishedAt);
  const staleTweetCutoff = Date.UTC(2022, 0, 1);
  if (isTweetish(article, feedUrl) && (!parsed || parsed < staleTweetCutoff)) {
    return {
      originalPublishedAt,
      publishedAt: fetchedAt || new Date().toISOString(),
    };
  }

  return {
    originalPublishedAt,
    publishedAt: originalPublishedAt,
  };
}

function toAmbientItem(article: Article, feedUrl: string, fetchedAt: string | null): AmbientFeedItem | null {
  const url = article.link?.trim();
  const title = article.title?.trim();
  if (!url || !title) return null;
  const { originalPublishedAt, publishedAt } = resolvePublishedAt(article, feedUrl, fetchedAt);

  return {
    id: article.id || url,
    title,
    url,
    originalPublishedAt,
    publishedAt,
    sourceTitle: article.sourceTitle || null,
    sourceUrl: article.sourceUrl || null,
    contentSnippet: article.contentSnippet || null,
    content: article.content || null,
  };
}

export async function GET(request: NextRequest) {
  const limitParam = Number(request.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 240) : 160;
  const feeds = listSavedFeeds();

  const results = await Promise.all(
    feeds.map(async (feed) => {
      try {
        return await ingestFeed(feed.url);
      } catch (error) {
        return {
          url: feed.url,
          title: feed.title,
          articleCount: 0,
          fetchedAt: new Date().toISOString(),
          response: null,
          error: error instanceof Error ? error.message : 'Failed to ingest feed',
        };
      }
    })
  );

  const deduped = new Map<string, AmbientFeedItem>();
  for (const result of results) {
    for (const article of result.response?.items ?? []) {
      const item = toAmbientItem(article, result.url, result.fetchedAt);
      if (!item) continue;
      const key = item.url || item.title;
      const existing = deduped.get(key);
      if (!existing || parsePublishedAt(item.publishedAt) > parsePublishedAt(existing.publishedAt)) {
        deduped.set(key, item);
      }
    }
  }

  const items = [...deduped.values()]
    .sort((a, b) => parsePublishedAt(b.publishedAt) - parsePublishedAt(a.publishedAt))
    .slice(0, limit);

  return NextResponse.json({
    items,
    totalFeeds: feeds.length,
    successfulFeeds: results.filter((result) => !result.error).length,
    failedFeeds: results.filter((result) => Boolean(result.error)).length,
    refreshedAt: new Date().toISOString(),
  });
}
