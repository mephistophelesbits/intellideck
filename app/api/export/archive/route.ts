import { NextResponse } from 'next/server';
import { getDb } from '@/lib/server/db';

export async function GET() {
  const db = getDb();
  const exportedAt = new Date().toISOString();

  const archive = {
    exportedAt,
    version: 1,
    appSettings: db.prepare(`SELECT * FROM app_settings`).all(),
    bookmarks: db.prepare(`SELECT * FROM bookmarks ORDER BY updated_at DESC, created_at DESC`).all(),
    searchRules: db.prepare(`SELECT * FROM search_rules ORDER BY updated_at DESC, created_at DESC`).all(),
    savedFeeds: db.prepare(`SELECT * FROM saved_feeds ORDER BY updated_at DESC, created_at DESC`).all(),
    columnsState: db.prepare(`SELECT * FROM columns_state ORDER BY position ASC, created_at ASC`).all(),
    articles: db.prepare(`SELECT * FROM articles ORDER BY updated_at DESC`).all(),
    articleAnalysis: db.prepare(`SELECT * FROM article_analysis`).all(),
    locations: db.prepare(`SELECT * FROM locations`).all(),
    articleLocations: db.prepare(`SELECT * FROM article_locations`).all(),
    entities: db.prepare(`SELECT * FROM entities`).all(),
    articleEntities: db.prepare(`SELECT * FROM article_entities`).all(),
    themes: db.prepare(`SELECT * FROM themes`).all(),
    articleThemes: db.prepare(`SELECT * FROM article_themes`).all(),
    briefings: db.prepare(`SELECT * FROM briefings ORDER BY briefing_date DESC`).all(),
    briefingChatMessages: db.prepare(`SELECT * FROM briefing_chat_messages ORDER BY created_at ASC`).all(),
    trendSnapshots: db.prepare(`SELECT * FROM trend_snapshots ORDER BY snapshot_date DESC`).all(),
  };

  return new NextResponse(JSON.stringify(archive, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="rssdeck-archive-${exportedAt.slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
