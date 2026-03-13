import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/server/db';

type ArchivePayload = {
  appSettings?: Array<Record<string, unknown>>;
  bookmarks?: Array<Record<string, unknown>>;
  searchRules?: Array<Record<string, unknown>>;
  savedFeeds?: Array<Record<string, unknown>>;
  columnsState?: Array<Record<string, unknown>>;
  articles?: Array<Record<string, unknown>>;
  articleAnalysis?: Array<Record<string, unknown>>;
  locations?: Array<Record<string, unknown>>;
  articleLocations?: Array<Record<string, unknown>>;
  entities?: Array<Record<string, unknown>>;
  articleEntities?: Array<Record<string, unknown>>;
  themes?: Array<Record<string, unknown>>;
  articleThemes?: Array<Record<string, unknown>>;
  briefings?: Array<Record<string, unknown>>;
  briefingChatMessages?: Array<Record<string, unknown>>;
  trendSnapshots?: Array<Record<string, unknown>>;
};

export async function POST(request: NextRequest) {
  const db = getDb();

  try {
    const archive = await request.json() as ArchivePayload;

    db.exec('BEGIN');

    db.exec(`
      DELETE FROM briefing_chat_messages;
      DELETE FROM briefings;
      DELETE FROM trend_snapshots;
      DELETE FROM article_themes;
      DELETE FROM themes;
      DELETE FROM article_entities;
      DELETE FROM entities;
      DELETE FROM article_locations;
      DELETE FROM locations;
      DELETE FROM article_analysis;
      DELETE FROM articles;
      DELETE FROM bookmarks;
      DELETE FROM search_rules;
      DELETE FROM app_settings;
      DELETE FROM columns_state;
      DELETE FROM saved_feeds;
    `);

    const insertAppSettings = db.prepare(`
      INSERT INTO app_settings (id, settings_json, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const row of archive.appSettings ?? []) {
      insertAppSettings.run(
        row.id,
        row.settings_json,
        row.created_at,
        row.updated_at
      );
    }

    const insertBookmark = db.prepare(`
      INSERT INTO bookmarks (id, article_json, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const row of archive.bookmarks ?? []) {
      insertBookmark.run(
        row.id,
        row.article_json,
        row.created_at,
        row.updated_at
      );
    }

    const insertSearchRule = db.prepare(`
      INSERT INTO search_rules (id, name, query, keywords_json, created_at, updated_at, last_run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of archive.searchRules ?? []) {
      insertSearchRule.run(
        row.id,
        row.name,
        row.query,
        row.keywords_json,
        row.created_at,
        row.updated_at,
        row.last_run_at ?? null
      );
    }

    const insertSavedFeed = db.prepare(`
      INSERT INTO saved_feeds (id, url, title, site_url, last_fetched_at, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of archive.savedFeeds ?? []) {
      insertSavedFeed.run(
        row.id,
        row.url,
        row.title,
        row.site_url ?? null,
        row.last_fetched_at ?? null,
        row.last_error ?? null,
        row.created_at,
        row.updated_at
      );
    }

    const insertColumn = db.prepare(`
      INSERT INTO columns_state (id, title, type, width, position, refresh_interval, view_mode, sources_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of archive.columnsState ?? []) {
      insertColumn.run(
        row.id,
        row.title,
        row.type,
        row.width,
        row.position,
        row.refresh_interval,
        row.view_mode,
        row.sources_json,
        row.created_at,
        row.updated_at
      );
    }

    const insertArticle = db.prepare(`
      INSERT INTO articles (id, source_url, source_title, canonical_url, title, published_at, author, content_snippet, raw_content, scraped_html, scraped_text, language, image_url, hash_fingerprint, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of archive.articles ?? []) {
      insertArticle.run(
        row.id,
        row.source_url,
        row.source_title ?? null,
        row.canonical_url,
        row.title,
        row.published_at ?? null,
        row.author ?? null,
        row.content_snippet ?? null,
        row.raw_content ?? null,
        row.scraped_html ?? null,
        row.scraped_text ?? null,
        row.language ?? null,
        row.image_url ?? null,
        row.hash_fingerprint ?? null,
        row.created_at,
        row.updated_at
      );
    }

    const insertAnalysis = db.prepare(`
      INSERT INTO article_analysis (article_id, primary_category, tags_json, importance_score, analyzed_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const row of archive.articleAnalysis ?? []) {
      insertAnalysis.run(
        row.article_id,
        row.primary_category,
        row.tags_json,
        row.importance_score,
        row.analyzed_at
      );
    }

    const insertLocation = db.prepare(`
      INSERT INTO locations (id, name, normalized_name, country_code, lat, lng, location_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of archive.locations ?? []) {
      insertLocation.run(
        row.id,
        row.name,
        row.normalized_name,
        row.country_code,
        row.lat,
        row.lng,
        row.location_type,
        row.created_at,
        row.updated_at
      );
    }

    const insertArticleLocation = db.prepare(`
      INSERT INTO article_locations (article_id, location_id, mention_count, weight, context_excerpt)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const row of archive.articleLocations ?? []) {
      insertArticleLocation.run(
        row.article_id,
        row.location_id,
        row.mention_count,
        row.weight,
        row.context_excerpt ?? null
      );
    }

    const insertEntity = db.prepare(`
      INSERT INTO entities (id, name, normalized_name, entity_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const row of archive.entities ?? []) {
      insertEntity.run(
        row.id,
        row.name,
        row.normalized_name,
        row.entity_type,
        row.created_at,
        row.updated_at
      );
    }

    const insertArticleEntity = db.prepare(`
      INSERT INTO article_entities (article_id, entity_id, mention_count, weight)
      VALUES (?, ?, ?, ?)
    `);
    for (const row of archive.articleEntities ?? []) {
      insertArticleEntity.run(
        row.article_id,
        row.entity_id,
        row.mention_count,
        row.weight
      );
    }

    const insertTheme = db.prepare(`
      INSERT INTO themes (id, name, normalized_name, category_hint, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const row of archive.themes ?? []) {
      insertTheme.run(
        row.id,
        row.name,
        row.normalized_name,
        row.category_hint ?? null,
        row.created_at,
        row.updated_at
      );
    }

    const insertArticleTheme = db.prepare(`
      INSERT INTO article_themes (article_id, theme_id, score)
      VALUES (?, ?, ?)
    `);
    for (const row of archive.articleThemes ?? []) {
      insertArticleTheme.run(
        row.article_id,
        row.theme_id,
        row.score
      );
    }

    const insertBriefing = db.prepare(`
      INSERT INTO briefings (id, briefing_date, title, executive_summary, key_themes_json, top_stories_json, scope_json, created_at, model_provider, model_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of archive.briefings ?? []) {
      insertBriefing.run(
        row.id,
        row.briefing_date,
        row.title,
        row.executive_summary,
        row.key_themes_json,
        row.top_stories_json,
        row.scope_json,
        row.created_at,
        row.model_provider ?? null,
        row.model_name ?? null
      );
    }

    const insertBriefingChat = db.prepare(`
      INSERT INTO briefing_chat_messages (id, briefing_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const row of archive.briefingChatMessages ?? []) {
      insertBriefingChat.run(
        row.id,
        row.briefing_id,
        row.role,
        row.content,
        row.created_at
      );
    }

    const insertTrendSnapshot = db.prepare(`
      INSERT INTO trend_snapshots (id, snapshot_date, window_type, metric_type, metric_key, value, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of archive.trendSnapshots ?? []) {
      insertTrendSnapshot.run(
        row.id,
        row.snapshot_date,
        row.window_type,
        row.metric_type,
        row.metric_key,
        row.value,
        row.created_at
      );
    }

    db.exec('COMMIT');

    return NextResponse.json({
      restoredAt: new Date().toISOString(),
      counts: {
        settings: archive.appSettings?.length ?? 0,
        bookmarks: archive.bookmarks?.length ?? 0,
        feeds: archive.savedFeeds?.length ?? 0,
        columns: archive.columnsState?.length ?? 0,
        articles: archive.articles?.length ?? 0,
        briefings: archive.briefings?.length ?? 0,
      },
    });
  } catch (error: unknown) {
    try {
      db.exec('ROLLBACK');
    } catch {}

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to import archive' },
      { status: 500 }
    );
  }
}
