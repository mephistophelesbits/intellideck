import 'server-only';

import Parser from 'rss-parser';
import { Article, FeedResponse } from '@/lib/types';
import { generateId } from '@/lib/utils';
import { persistArticles } from '@/lib/server/articles-repository';
import { listSavedFeeds, recordFeedFetchResult } from '@/lib/server/deck-repository';

const parser = new Parser({
  customFields: {
    item: [
      ['media:thumbnail', 'mediaThumbnail'],
      ['media:content', 'mediaContent'],
      ['enclosure', 'enclosure'],
      ['content:encoded', 'contentEncoded'],
      ['dc:creator', 'dcCreator'],
    ],
  },
  headers: {
    'User-Agent': 'RSS-Deck/1.0 (RSS Reader Application)',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
  timeout: 10000,
});

async function parseFeedFromUrl(fetchUrl: string) {
  const attempts: Array<() => Promise<FeedResponse>> = [
    async () => {
      const rssResponse = await fetch(fetchUrl, {
        headers: {
          'User-Agent': 'RSS-Deck/1.0 (RSS Reader Application)',
          Accept: 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });

      if (!rssResponse.ok) {
        throw new Error(`HTTP error! status: ${rssResponse.status}`);
      }

      const xml = await rssResponse.text();
      const feed = await parser.parseString(xml);
      return {
        title: feed.title || 'Unknown Feed',
        description: feed.description,
        link: feed.link,
        items: feed.items.map((item) => {
          const itemRecord = item as unknown as Record<string, unknown>;
          return {
            id: item.guid || item.link || generateId(),
            title: item.title || 'Untitled',
            link: item.link || '',
            pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
            contentSnippet: item.contentSnippet?.slice(0, 300),
            content: (itemRecord.contentEncoded as string) || item.content,
            author: (itemRecord.dcCreator as string) || item.creator,
            thumbnail: extractThumbnail(itemRecord),
            sourceTitle: feed.title,
            sourceUrl: feed.link,
          };
        }),
      };
    },
    async () => {
      const feed = await parser.parseURL(fetchUrl);
      return {
        title: feed.title || 'Unknown Feed',
        description: feed.description,
        link: feed.link,
        items: feed.items.map((item) => {
          const itemRecord = item as unknown as Record<string, unknown>;
          return {
            id: item.guid || item.link || generateId(),
            title: item.title || 'Untitled',
            link: item.link || '',
            pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
            contentSnippet: item.contentSnippet?.slice(0, 300),
            content: (itemRecord.contentEncoded as string) || item.content,
            author: (itemRecord.dcCreator as string) || item.creator,
            thumbnail: extractThumbnail(itemRecord),
            sourceTitle: feed.title,
            sourceUrl: feed.link,
          };
        }),
      };
    },
  ];

  let lastError: Error | null = null;

  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Failed to parse feed');
    }
  }

  throw lastError ?? new Error('Failed to parse feed');
}

function normalizeFeedUrl(url: string) {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return `http://${url}`;
}

function extractThumbnail(item: Record<string, unknown>): string | undefined {
  if (item.mediaThumbnail && typeof item.mediaThumbnail === 'object') {
    const thumb = item.mediaThumbnail as { $?: { url?: string } };
    if (thumb.$?.url) return thumb.$.url;
  }

  if (item.mediaContent && typeof item.mediaContent === 'object') {
    const media = item.mediaContent as { $?: { url?: string } };
    if (media.$?.url) return media.$.url;
  }

  if (item.enclosure && typeof item.enclosure === 'object') {
    const enc = item.enclosure as { url?: string; type?: string };
    if (enc.url && enc.type?.startsWith('image/')) {
      return enc.url;
    }
  }

  return undefined;
}

export async function fetchFeedData(url: string) {
  const fetchUrl = normalizeFeedUrl(url);
  const response = await parseFeedFromUrl(fetchUrl);

  return {
    fetchUrl,
    response,
  };
}

export async function ingestFeed(url: string) {
  const fetchedAt = new Date().toISOString();
  try {
    const { fetchUrl, response } = await fetchFeedData(url);
    persistArticles(fetchUrl, response.title, response.items);
    recordFeedFetchResult(url, {
      title: response.title,
      siteUrl: response.link ?? null,
      fetchedAt,
      error: null,
    });

    return {
      url,
      title: response.title,
      siteUrl: response.link ?? null,
      articleCount: response.items.length,
      fetchedAt,
      response,
      error: null as string | null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to ingest feed';
    recordFeedFetchResult(url, {
      fetchedAt,
      error: message,
    });
    return {
      url,
      title: null,
      siteUrl: null,
      articleCount: 0,
      fetchedAt,
      response: null,
      error: message,
    };
  }
}

export async function refreshSavedFeeds(limit?: number) {
  const feeds = listSavedFeeds();
  const selectedFeeds = typeof limit === 'number' && limit > 0 ? feeds.slice(0, limit) : feeds;
  const results = [];

  for (const feed of selectedFeeds) {
    results.push(await ingestFeed(feed.url));
  }

  return {
    totalFeeds: selectedFeeds.length,
    successfulFeeds: results.filter((result) => !result.error).length,
    failedFeeds: results.filter((result) => Boolean(result.error)).length,
    totalArticles: results.reduce((sum, result) => sum + result.articleCount, 0),
    results,
    refreshedAt: new Date().toISOString(),
  };
}
