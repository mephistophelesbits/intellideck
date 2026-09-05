import 'server-only';

import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { DatabaseSync } from 'node:sqlite';
import type { DatabaseSync as SqliteDatabaseSync } from 'node:sqlite';
import * as sqliteVec from 'sqlite-vec';

let database: SqliteDatabaseSync | null = null;
const MAX_STORED_ARTICLE_CONTENT_CHARS = 80_000;

function getDatabasePath() {
  // In Electron production, RSSDECK_DATA_DIR is set to app.getPath('userData')
  // so the DB lives in ~/Library/Application Support/IntelliDeck/ and survives updates.
  // In dev / web-only mode it falls back to <cwd>/data/.
  const dataDir = process.env.RSSDECK_DATA_DIR
    ? path.join(process.env.RSSDECK_DATA_DIR, 'data')
    : path.join(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'intellideck.db');
}

function initializeDatabase(db: SqliteDatabaseSync) {
  // sqlite-vec: local-first vector store for embeddings (IntelliDeck 2.0 graph foundation).
  // node:sqlite requires the connection to be opened with { allowExtension: true } (see getDb)
  // and extension loading to be explicitly enabled around the load call.
  try {
    db.enableLoadExtension(true);
    db.loadExtension(sqliteVec.getLoadablePath());
    db.enableLoadExtension(false);
  } catch (error) {
    console.error('[db] Failed to load sqlite-vec extension:', error);
    throw error;
  }

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
      label_color TEXT NOT NULL DEFAULT '#f97316',
      query TEXT NOT NULL,
      keywords_json TEXT NOT NULL,
      settings_json TEXT NOT NULL DEFAULT '{"matchMode":"or","excludeKeywords":[]}',
      order_index INTEGER NOT NULL,
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

    CREATE TABLE IF NOT EXISTS read_articles (
      article_id TEXT PRIMARY KEY,
      read_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS article_feedback (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      value INTEGER NOT NULL CHECK(value IN (-1, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(article_id),
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS article_impressions (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      surface TEXT NOT NULL,
      position INTEGER NOT NULL,
      score REAL NOT NULL,
      variant TEXT NOT NULL,
      shown_at TEXT NOT NULL,
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS preference_weights (
      feature_type TEXT NOT NULL,
      feature_key TEXT NOT NULL,
      weight REAL NOT NULL,
      positive_count INTEGER NOT NULL DEFAULT 0,
      negative_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(feature_type, feature_key)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS article_vectors USING vec0(
      article_id TEXT PRIMARY KEY,
      embedding FLOAT[768]
    );

    CREATE TABLE IF NOT EXISTS content_drafts (
      id          TEXT PRIMARY KEY,
      source_type TEXT,
      source_id   TEXT,
      platform    TEXT NOT NULL,
      angle       TEXT,
      draft       TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'draft',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_content_drafts_source ON content_drafts(source_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_content_drafts_created ON content_drafts(created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_list_items_list_feed
      ON feed_list_items(list_id, feed_id);

    CREATE INDEX IF NOT EXISTS idx_feed_list_items_list_id
      ON feed_list_items(list_id, position);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_canonical_url ON articles(canonical_url);
    CREATE INDEX IF NOT EXISTS idx_articles_source_url_published ON articles(source_url, published_at DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_articles_display_date ON articles(COALESCE(published_at, created_at) DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_articles_source_url_display_date ON articles(source_url, COALESCE(published_at, created_at) DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_articles_updated_at ON articles(updated_at);
    CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_article_analysis_category ON article_analysis(primary_category);
    CREATE INDEX IF NOT EXISTS idx_article_entities_entity_id ON article_entities(entity_id);
    CREATE INDEX IF NOT EXISTS idx_article_themes_theme_id ON article_themes(theme_id);
    CREATE INDEX IF NOT EXISTS idx_search_rules_updated_at ON search_rules(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_article_feedback_article_id ON article_feedback(article_id);
    CREATE INDEX IF NOT EXISTS idx_article_impressions_surface_shown ON article_impressions(surface, shown_at DESC);
    CREATE INDEX IF NOT EXISTS idx_article_impressions_article_surface_shown ON article_impressions(article_id, surface, shown_at DESC);
    CREATE INDEX IF NOT EXISTS idx_preference_weights_type_weight ON preference_weights(feature_type, weight DESC);
  `);

  ensureColumn(db, 'saved_feeds', 'site_url', 'TEXT');
  ensureColumn(db, 'saved_feeds', 'last_fetched_at', 'TEXT');
  ensureColumn(db, 'saved_feeds', 'last_error', 'TEXT');
  ensureColumn(db, 'columns_state', 'feed_list_id', 'TEXT');
  ensureColumn(db, 'columns_state', 'search_rule_id', 'TEXT');
  ensureColumn(db, 'search_rules', 'label_color', 'TEXT NOT NULL DEFAULT \'#f97316\'');
  ensureColumn(db, 'search_rules', 'settings_json', 'TEXT NOT NULL DEFAULT \'{"matchMode":"or","excludeKeywords":[]}\'');
  ensureColumn(db, 'search_rules', 'order_index', 'INTEGER');

  // IntelliDeck 2.0 Phase 1: enrich entities with rolling summary + salience + lifecycle.
  ensureColumn(db, 'entities', 'aliases', 'TEXT');
  ensureColumn(db, 'entities', 'summary', 'TEXT');
  ensureColumn(db, 'entities', 'salience', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'entities', 'mention_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'entities', 'first_seen', 'TEXT');
  ensureColumn(db, 'entities', 'last_seen', 'TEXT');
  ensureColumn(db, 'entities', 'summary_dirty_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'entities', 'summary_updated_at', 'TEXT');

  // Per-mention signal used by salience and semantic ranking.
  ensureColumn(db, 'article_entities', 'salience', 'REAL');
  ensureColumn(db, 'article_entities', 'sentiment', 'REAL');
  ensureColumn(db, 'article_entities', 'snippet', 'TEXT');
  dropRetiredIntelligenceSchema(db);
}

function dropRetiredIntelligenceSchema(db: SqliteDatabaseSync) {
  db.exec(`
    DROP TABLE IF EXISTS briefing_chat_messages;
    DROP TABLE IF EXISTS briefings;
    DROP TABLE IF EXISTS actor_stance_history;
    DROP TABLE IF EXISTS interval_briefs;
    DROP TABLE IF EXISTS world_synthesis;
    DROP TABLE IF EXISTS story_web_context;
    DROP TABLE IF EXISTS story_reads;
    DROP TABLE IF EXISTS story_events;
    DROP TABLE IF EXISTS story_articles;
    DROP TABLE IF EXISTS stories;
    DROP TABLE IF EXISTS topic_articles;
    DROP TABLE IF EXISTS topic_digest;
    DROP TABLE IF EXISTS topics;
  `);
}

function ensureColumn(db: SqliteDatabaseSync, tableName: string, columnName: string, columnDefinition: string) {
  const table = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName) as { name: string } | undefined;

  if (!table) {
    return;
  }

  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}

function normalizeLegacyArticleDates(db: SqliteDatabaseSync) {
  const rows = db.prepare(`
    SELECT id, published_at
    FROM articles
    WHERE published_at IS NOT NULL
      AND published_at NOT GLOB '????-??-??T*'
    LIMIT 1000
  `).all() as Array<{ id: string; published_at: string }>;

  if (rows.length === 0) return;

  const update = db.prepare('UPDATE articles SET published_at = ? WHERE id = ?');
  let normalizedCount = 0;

  for (const row of rows) {
    const parsed = Date.parse(row.published_at);
    if (!Number.isFinite(parsed)) continue;

    update.run(new Date(parsed).toISOString(), row.id);
    normalizedCount += 1;
  }

  if (normalizedCount > 0) {
    console.log(`[Migration] Normalized ${normalizedCount} legacy article published_at values`);
  }
}

function compactDuplicateImpressions(db: SqliteDatabaseSync) {
  const row = db.prepare('SELECT COUNT(*) AS count FROM article_impressions').get() as { count: number };
  if (row.count < 10_000) return;

  const result = db.prepare(`
    DELETE FROM article_impressions
    WHERE rowid NOT IN (
      SELECT MAX(rowid)
      FROM article_impressions
      GROUP BY surface, article_id, substr(shown_at, 1, 10)
    )
  `).run() as { changes: number };

  if (result.changes > 0) {
    console.log(`[Maintenance] Removed ${result.changes} duplicate article impressions`);
  }
}

function compactOversizedArticleContent(db: SqliteDatabaseSync) {
  const result = db.prepare(`
    UPDATE articles
    SET
      raw_content = CASE
        WHEN raw_content IS NOT NULL AND length(raw_content) > ? THEN substr(raw_content, 1, ?)
        ELSE raw_content
      END,
      scraped_html = CASE
        WHEN scraped_html IS NOT NULL AND length(scraped_html) > ? THEN substr(scraped_html, 1, ?)
        ELSE scraped_html
      END,
      scraped_text = CASE
        WHEN scraped_text IS NOT NULL AND length(scraped_text) > ? THEN substr(scraped_text, 1, ?)
        ELSE scraped_text
      END
    WHERE length(COALESCE(raw_content, '')) > ?
      OR length(COALESCE(scraped_html, '')) > ?
      OR length(COALESCE(scraped_text, '')) > ?
  `).run(
    MAX_STORED_ARTICLE_CONTENT_CHARS,
    MAX_STORED_ARTICLE_CONTENT_CHARS,
    MAX_STORED_ARTICLE_CONTENT_CHARS,
    MAX_STORED_ARTICLE_CONTENT_CHARS,
    MAX_STORED_ARTICLE_CONTENT_CHARS,
    MAX_STORED_ARTICLE_CONTENT_CHARS,
    MAX_STORED_ARTICLE_CONTENT_CHARS,
    MAX_STORED_ARTICLE_CONTENT_CHARS,
    MAX_STORED_ARTICLE_CONTENT_CHARS
  ) as { changes: number };

  if (result.changes > 0) {
    console.log(`[Maintenance] Trimmed oversized content for ${result.changes} articles`);
  }
}

/**
 * Run one-time migrations for features that need to convert existing data.
 * This is called once on first database connection.
 */
function runMigrations(db: SqliteDatabaseSync) {
  normalizeLegacyArticleDates(db);
  compactDuplicateImpressions(db);
  compactOversizedArticleContent(db);

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
    const db = new DatabaseSync(getDatabasePath(), { allowExtension: true });
    try {
      initializeDatabase(db);
      runMigrations(db);
    } catch (err) {
      // Don't cache a partially-initialized DB — next call will retry.
      try { db.close(); } catch { /* ignore */ }
      throw err;
    }
    database = db;
  }

  return database;
}

/**
 * Delete articles (and their cascade-linked analysis/locations/entities/themes)
 * older than `daysToKeep` days. Also prunes old trend_snapshots and impressions.
 *
 * Returns the number of records deleted.
 */
export function runRetentionCleanup(daysToKeep: number): { articlesDeleted: number; snapshotsDeleted: number; impressionsDeleted: number } {
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

  const impressionCutoff = new Date(Date.now() - Math.min(daysToKeep, 30) * 24 * 60 * 60 * 1000).toISOString();
  const impressionResult = db.prepare(
    `DELETE FROM article_impressions WHERE shown_at < ?`
  ).run(impressionCutoff) as { changes: number };

  // Vacuum to reclaim disk space
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');

  return {
    articlesDeleted: articleResult.changes,
    snapshotsDeleted: snapshotResult.changes,
    impressionsDeleted: impressionResult.changes,
  };
}
