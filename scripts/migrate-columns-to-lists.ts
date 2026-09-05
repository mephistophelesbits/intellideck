/**
 * Migration script to convert existing columns with feeds into feed_lists.
 * 
 * This script reads all columns from columns_state, and for each column that has
 * feeds (sources), creates a corresponding feed_list and adds all the feeds to it.
 * 
 * This can be run:
 * - Manually: npx tsx scripts/migrate-columns-to-lists.ts
 * - Automatically: Call migrateColumnsToLists() from db.ts on app startup
 */

import { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import path from 'path';

interface FeedSource {
  id: string;
  url: string;
  title: string;
  siteUrl?: string;
  lastFetchedAt?: string;
  lastError?: string;
}

interface ColumnRow {
  id: string;
  title: string;
  type: string;
  sources_json: string;
}

interface MigrationStats {
  listsCreated: number;
  feedsAdded: number;
}

export function migrateColumnsToLists(db: DatabaseSync): MigrationStats {
  const now = new Date().toISOString();

  // Ensure feed_lists table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS feed_lists (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Ensure feed_list_items table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS feed_list_items (
      id         TEXT PRIMARY KEY,
      list_id    TEXT NOT NULL REFERENCES feed_lists(id) ON DELETE CASCADE,
      feed_id    TEXT NOT NULL REFERENCES saved_feeds(id) ON DELETE CASCADE,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  // Ensure indexes exist
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_feed_list_items_list_feed
      ON feed_list_items(list_id, feed_id);
    CREATE INDEX IF NOT EXISTS idx_feed_list_items_list_id
      ON feed_list_items(list_id, position);
  `);

  // Get all columns with feeds
  const columns = db.prepare(`
    SELECT id, title, type, sources_json
    FROM columns_state
    WHERE sources_json IS NOT NULL AND sources_json != '[]' AND sources_json != ''
  `).all() as ColumnRow[];

  console.log(`Found ${columns.length} columns with feeds to migrate...`);

  let listsCreated = 0;
  let feedsAdded = 0;

  for (const column of columns) {
    let sources: FeedSource[] = [];
    try {
      sources = JSON.parse(column.sources_json);
    } catch {
      console.error(`Failed to parse sources_json for column ${column.id}`);
      continue;
    }

    if (sources.length === 0) {
      continue;
    }

    // Create feed_list for this column
    const listId = nanoid();
    const listName = column.title;

    db.prepare(`
      INSERT INTO feed_lists (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(listId, listName, now, now);

    console.log(`Created list "${listName}" (${listId}) for column ${column.id}`);

    // Ensure saved_feeds table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS saved_feeds (
        id         TEXT PRIMARY KEY,
        url        TEXT NOT NULL UNIQUE,
        title      TEXT NOT NULL,
        site_url   TEXT,
        last_fetched_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Add each feed to the list
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];

      // Insert or get saved_feed
      try {
        db.prepare(`
          INSERT INTO saved_feeds (id, url, title, site_url, last_fetched_at, last_error, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(url) DO UPDATE SET
            title = excluded.title,
            site_url = COALESCE(excluded.site_url, saved_feeds.site_url),
            updated_at = excluded.updated_at
        `).run(
          source.id,
          source.url,
          source.title,
          source.siteUrl ?? null,
          source.lastFetchedAt ?? null,
          source.lastError ?? null,
          now,
          now
        );
      } catch (e) {
        // Feed might already exist with different id, try to use the existing one
        const existing = db.prepare('SELECT id FROM saved_feeds WHERE url = ?').get(source.url) as { id: string } | undefined;
        if (existing) {
          source.id = existing.id;
        } else {
          throw e;
        }
      }

      // Add to feed_list_items - use INSERT OR IGNORE to handle duplicates
      const itemId = nanoid();
      try {
        db.prepare(`
          INSERT INTO feed_list_items (id, list_id, feed_id, position, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(itemId, listId, source.id, i, now);
        feedsAdded++;
      } catch {
        // Item might already exist, skip
        console.log(`  Feed ${source.url} already in list, skipping...`);
      }
    }

    listsCreated++;
  }

  // Also migrate any feeds in saved_feeds that aren't in any column
  const orphanedFeeds = db.prepare(`
    SELECT id, url, title FROM saved_feeds
    WHERE id NOT IN (SELECT DISTINCT value FROM columns_state, json_each(sources_json) WHERE sources_json != '[]')
  `).all() as Array<{ id: string; url: string; title: string }>;

  if (orphanedFeeds.length > 0) {
    console.log(`Found ${orphanedFeeds.length} orphaned feeds not in any column...`);

    const listId = nanoid();
    db.prepare('INSERT INTO feed_lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(listId, 'Other Feeds', now, now);

    console.log(`Created list "Other Feeds" for orphaned feeds`);

    for (let i = 0; i < orphanedFeeds.length; i++) {
      const feed = orphanedFeeds[i];
      try {
        const itemId = nanoid();
        db.prepare('INSERT INTO feed_list_items (id, list_id, feed_id, position, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(itemId, listId, feed.id, i, now);
        feedsAdded++;
      } catch {
        console.log(`  Feed ${feed.url} already in list, skipping...`);
      }
    }
    listsCreated++;
  }

  console.log(`\nMigration complete!`);
  console.log(`  Lists created: ${listsCreated}`);
  console.log(`  Feeds added: ${feedsAdded}`);

  return { listsCreated, feedsAdded };
}

// Run migration if executed directly (not imported as module)
if (require.main === module) {
  const dbPath = path.join(process.cwd(), 'data', 'intellideck.db');
  const db = new DatabaseSync(dbPath);
  migrateColumnsToLists(db);
}
