import 'server-only';

import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

let database: DatabaseSync | null = null;

function getDatabasePath() {
  const dataDir = path.join(process.cwd(), 'data');
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
}

function ensureColumn(db: DatabaseSync, tableName: string, columnName: string, columnDefinition: string) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}

export function getDb() {
  if (!database) {
    database = new DatabaseSync(getDatabasePath());
    initializeDatabase(database);
  }

  return database;
}
