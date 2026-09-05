import { NextResponse } from 'next/server';
import { DEFAULT_COLUMNS, DEFAULT_SAVED_FEEDS } from '@/lib/default-deck';
import { getDb } from '@/lib/server/db';
import type { Column, DeckStateSnapshot, FeedSource } from '@/lib/types';

type ColumnRow = {
  id: string;
  title: string;
  type: Column['type'];
  width: number;
  refresh_interval: number;
  view_mode: Column['settings']['viewMode'];
  sources_json: string;
  feed_list_id: string | null;
  search_rule_id: string | null;
};

type FeedRow = {
  id: string;
  url: string;
  title: string;
  site_url: string | null;
  last_fetched_at: string | null;
  last_error: string | null;
};

function readDeckSnapshot(): DeckStateSnapshot {
  const db = getDb();

  const columnRows = db.prepare(`
    SELECT id, title, type, width, refresh_interval, view_mode, sources_json, feed_list_id, search_rule_id
    FROM columns_state
    ORDER BY position ASC, created_at ASC
  `).all() as ColumnRow[];

  const feedRows = db.prepare(`
    SELECT id, url, title, site_url, last_fetched_at, last_error
    FROM saved_feeds
    ORDER BY updated_at DESC, created_at DESC
  `).all() as FeedRow[];

  const columns: Column[] = columnRows.length > 0
    ? columnRows.map((row) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      width: row.width,
      sources: JSON.parse(row.sources_json) as FeedSource[],
      feedListId: row.feed_list_id ?? undefined,
      searchRuleId: row.search_rule_id ?? undefined,
      settings: {
        refreshInterval: row.refresh_interval,
        viewMode: row.view_mode,
      },
    }))
    : DEFAULT_COLUMNS;

  const savedFeeds: FeedSource[] = feedRows.length > 0
    ? feedRows.map((row) => ({
      id: row.id,
      url: row.url,
      title: row.title,
      siteUrl: row.site_url ?? undefined,
      lastFetchedAt: row.last_fetched_at ?? undefined,
      lastError: row.last_error ?? undefined,
    }))
    : DEFAULT_SAVED_FEEDS;

  return {
    columns,
    savedFeeds,
  };
}

export async function GET() {
  try {
    return NextResponse.json(readDeckSnapshot());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load deck state' },
      { status: 500 },
    );
  }
}
