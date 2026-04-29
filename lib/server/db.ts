import 'server-only';

import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { DatabaseSync } from 'node:sqlite';

let database: DatabaseSync | null = null;

function getDatabasePath() {
  // In Electron production, RSSDECK_DATA_DIR is set to app.getPath('userData')
  // so the DB lives in ~/Library/Application Support/RSS Deck/ and survives updates.
  // In dev / web-only mode it falls back to <cwd>/data/.
  const dataDir = process.env.RSSDECK_DATA_DIR
    ? path.join(process.env.RSSDECK_DATA_DIR, 'data')
    : path.join(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'rssdeck.db');
}

function initializeDatabase(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS saved_feeds (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS columns_state (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      width INTEGER NOT NULL,
      position INTEGER NOT NULL,
      refresh_interval INTEGER NOT NULL,
      view_mode TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY,
      settings_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY,
      article_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS search_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      query TEXT NOT NULL,
      keywords_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_run_at TEXT
    );

    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      source_url TEXT NOT NULL,
      source_title TEXT,
      canonical_url TEXT NOT NULL,
      title TEXT NOT NULL,
      published_at TEXT,
      author TEXT,
      content_snippet TEXT,
      raw_content TEXT,
      scraped_html TEXT,
      scraped_text TEXT,
      language TEXT,
      image_url TEXT,
      hash_fingerprint TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS briefings (
      id TEXT PRIMARY KEY,
      briefing_date TEXT NOT NULL,
      title TEXT NOT NULL,
      executive_summary TEXT NOT NULL,
      key_themes_json TEXT NOT NULL,
      top_stories_json TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      model_provider TEXT,
      model_name TEXT
    );

    CREATE TABLE IF NOT EXISTS trend_snapshots (
      id TEXT PRIMARY KEY,
      snapshot_date TEXT NOT NULL,
      window_type TEXT NOT NULL,
      metric_type TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      value REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_search_results (
      id TEXT PRIMARY KEY,
      search_rule_id TEXT NOT NULL,
      article_json TEXT NOT NULL,
      matched_terms_json TEXT NOT NULL,
      relevance_score REAL NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(search_rule_id) REFERENCES search_rules(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS briefing_chat_messages (
      id TEXT PRIMARY KEY,
      briefing_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(briefing_id) REFERENCES briefings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS article_analysis (
      article_id TEXT PRIMARY KEY,
      primary_category TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      importance_score REAL NOT NULL,
      analyzed_at TEXT NOT NULL,
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      country_code TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      location_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS article_locations (
      article_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      mention_count INTEGER NOT NULL,
      weight REAL NOT NULL,
      context_excerpt TEXT,
      PRIMARY KEY(article_id, location_id),
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
      FOREIGN KEY(location_id) REFERENCES locations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      entity_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS article_entities (
      article_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      mention_count INTEGER NOT NULL,
      weight REAL NOT NULL,
      PRIMARY KEY(article_id, entity_id),
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
      FOREIGN KEY(entity_id) REFERENCES entities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS themes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      category_hint TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS article_themes (
      article_id TEXT NOT NULL,
      theme_id TEXT NOT NULL,
      score REAL NOT NULL,
      PRIMARY KEY(article_id, theme_id),
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
      FOREIGN KEY(theme_id) REFERENCES themes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS feed_lists (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feed_list_items (
      id         TEXT PRIMARY KEY,
      list_id    TEXT NOT NULL REFERENCES feed_lists(id) ON DELETE CASCADE,
      feed_id    TEXT NOT NULL REFERENCES saved_feeds(id) ON DELETE CASCADE,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_list_items_list_feed
      ON feed_list_items(list_id, feed_id);

    CREATE INDEX IF NOT EXISTS idx_feed_list_items_list_id
      ON feed_list_items(list_id, position);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_canonical_url ON articles(canonical_url);
    CREATE INDEX IF NOT EXISTS idx_articles_updated_at ON articles(updated_at);
    CREATE INDEX IF NOT EXISTS idx_briefings_briefing_date ON briefings(briefing_date);
    CREATE INDEX IF NOT EXISTS idx_article_analysis_category ON article_analysis(primary_category);
    CREATE INDEX IF NOT EXISTS idx_briefing_chat_messages_briefing_id ON briefing_chat_messages(briefing_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_article_entities_entity_id ON article_entities(entity_id);
    CREATE INDEX IF NOT EXISTS idx_article_themes_theme_id ON article_themes(theme_id);
    CREATE INDEX IF NOT EXISTS idx_search_rules_updated_at ON search_rules(updated_at DESC);
  `);

  ensureColumn(db, 'saved_feeds', 'site_url', 'TEXT');
  ensureColumn(db, 'saved_feeds', 'last_fetched_at', 'TEXT');
  ensureColumn(db, 'saved_feeds', 'last_error', 'TEXT');
  ensureColumn(db, 'columns_state', 'feed_list_id', 'TEXT');
  ensureColumn(db, 'columns_state', 'search_rule_id', 'TEXT');
}

function ensureColumn(db: DatabaseSync, tableName: string, columnName: string, columnDefinition: string) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}

/**
 * Run one-time migrations for features that need to convert existing data.
 * This is called once on first database connection.
 */
function runMigrations(db: DatabaseSync) {
  // Check if we need to migrate columns to feed_lists
  const existingLists = db.prepare('SELECT COUNT(*) as count FROM feed_lists').get() as { count: number };
  if (existingLists.count === 0) {
    const now = new Date().toISOString();

    // First, collect all feed IDs that are referenced in any column's sources_json
    const columnsWithFeeds = db.prepare(`
      SELECT id, title, type, sources_json
      FROM columns_state
      WHERE sources_json IS NOT NULL AND sources_json != '[]' AND sources_json != ''
    `).all() as Array<{ id: string; title: string; type: string; sources_json: string }>;

    const allFeedIdsInColumns = new Set<string>();
    for (const column of columnsWithFeeds) {
      let sources: Array<{ id: string; url: string; title: string; siteUrl?: string; lastFetchedAt?: string; lastError?: string }> = [];
      try {
        sources = JSON.parse(column.sources_json);
      } catch {
        continue;
      }
      for (const source of sources) {
        allFeedIdsInColumns.add(source.id);
      }
    }

    // Migrate columns with feeds to feed_lists
    if (columnsWithFeeds.length > 0) {
      console.log(`[Migration] Found ${columnsWithFeeds.length} columns with feeds to migrate to feed_lists...`);

      for (const column of columnsWithFeeds) {
        let sources: Array<{ id: string; url: string; title: string; siteUrl?: string; lastFetchedAt?: string; lastError?: string }> = [];
        try {
          sources = JSON.parse(column.sources_json);
        } catch {
          console.error(`[Migration] Failed to parse sources_json for column ${column.id}`);
          continue;
        }

        if (sources.length === 0) continue;

        const listId = nanoid();
        db.prepare('INSERT INTO feed_lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
          .run(listId, column.title, now, now);

        console.log(`[Migration] Created list "${column.title}" for column ${column.id}`);

        for (let i = 0; i < sources.length; i++) {
          const source = sources[i];
          try {
            db.prepare(`
              INSERT INTO saved_feeds (id, url, title, site_url, last_fetched_at, last_error, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(url) DO UPDATE SET title = excluded.title
            `).run(source.id, source.url, source.title, source.siteUrl ?? null, source.lastFetchedAt ?? null, source.lastError ?? null, now, now);
          } catch {
            // Feed might exist with different ID, try to use existing
            const existing = db.prepare('SELECT id FROM saved_feeds WHERE url = ?').get(source.url) as { id: string } | undefined;
            if (existing) source.id = existing.id;
          }

          try {
            const itemId = nanoid();
            db.prepare('INSERT INTO feed_list_items (id, list_id, feed_id, position, created_at) VALUES (?, ?, ?, ?, ?)')
              .run(itemId, listId, source.id, i, now);
          } catch {
            // Item might already exist
          }
        }
      }
    }

    // Also migrate any feeds in saved_feeds that aren't in any column
    // These might be orphaned feeds from deleted columns or feeds added directly
    const orphanedFeeds = db.prepare(`
      SELECT id, url, title FROM saved_feeds
      WHERE id NOT IN (SELECT DISTINCT value FROM columns_state, json_each(sources_json) WHERE sources_json != '[]')
    `).all() as Array<{ id: string; url: string; title: string }>;

    if (orphanedFeeds.length > 0) {
      console.log(`[Migration] Found ${orphanedFeeds.length} orphaned feeds not in any column...`);

      const listId = nanoid();
      db.prepare('INSERT INTO feed_lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(listId, 'Other Feeds', now, now);

      console.log(`[Migration] Created list "Other Feeds" for orphaned feeds`);

      for (let i = 0; i < orphanedFeeds.length; i++) {
        const feed = orphanedFeeds[i];
        try {
          const itemId = nanoid();
          db.prepare('INSERT INTO feed_list_items (id, list_id, feed_id, position, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(itemId, listId, feed.id, i, now);
        } catch {
          // Item might already exist
        }
      }
    }

    console.log('[Migration] Feed lists migration complete');
  }
}

export function getDb() {
  if (!database) {
    database = new DatabaseSync(getDatabasePath());
    initializeDatabase(database);
    runMigrations(database);
  }

  return database;
}

/**
 * Delete articles (and their cascade-linked analysis/locations/entities/themes)
 * older than `daysToKeep` days. Also prunes old trend_snapshots.
 *
 * Returns the number of articles deleted.
 */
export function runRetentionCleanup(daysToKeep: number): { articlesDeleted: number; snapshotsDeleted: number } {
  const db = getDb();
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();

  // Articles: cascade deletes article_analysis, article_locations, article_entities, article_themes
  const articleResult = db.prepare(
    `DELETE FROM articles WHERE created_at < ?`
  ).run(cutoff) as { changes: number };

  // Trend snapshots — keep last 90 days regardless of daysToKeep (they're small)
  const snapshotCutoff = new Date(Date.now() - Math.max(daysToKeep, 90) * 24 * 60 * 60 * 1000).toISOString();
  const snapshotResult = db.prepare(
    `DELETE FROM trend_snapshots WHERE created_at < ?`
  ).run(snapshotCutoff) as { changes: number };

  // Vacuum to reclaim disk space
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');

  return {
    articlesDeleted: articleResult.changes,
    snapshotsDeleted: snapshotResult.changes,
  };
}
