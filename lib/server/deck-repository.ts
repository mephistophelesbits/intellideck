import 'server-only';

import { DEFAULT_COLUMNS, DEFAULT_SAVED_FEEDS } from '@/lib/default-deck';
import { Column, FeedSource, DeckStateSnapshot } from '@/lib/types';
import { getDb } from './db';

type ColumnRow = {
  id: string;
  title: string;
  type: Column['type'];
  width: number;
  position: number;
  refresh_interval: number;
  view_mode: Column['settings']['viewMode'];
  sources_json: string;
};

type FeedRow = {
  id: string;
  url: string;
  title: string;
  site_url: string | null;
  last_fetched_at: string | null;
  last_error: string | null;
};

export function getDeckState(): DeckStateSnapshot {
  seedDefaultsIfNeeded();

  return {
    columns: getColumns(),
    savedFeeds: getSavedFeeds(),
  };
}

export function createColumn(column: Column) {
  const db = getDb();
  const now = new Date().toISOString();
  const position = getColumns().length;

  db.prepare(`
    INSERT INTO columns_state (
      id, title, type, width, position, refresh_interval, view_mode, sources_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    column.id,
    column.title,
    column.type,
    column.width,
    position,
    column.settings.refreshInterval,
    column.settings.viewMode,
    JSON.stringify(column.sources),
    now,
    now
  );

  persistFeeds(column.sources);
  return getDeckState();
}

export function updateColumn(columnId: string, updates: Partial<Column>) {
  const db = getDb();
  const existing = getColumnById(columnId);

  if (!existing) {
    throw new Error('Column not found');
  }

  const nextColumn: Column = {
    ...existing,
    ...updates,
    settings: {
      ...existing.settings,
      ...updates.settings,
    },
    sources: updates.sources ?? existing.sources,
    width: updates.width ?? existing.width,
  };

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE columns_state
    SET title = ?, type = ?, width = ?, refresh_interval = ?, view_mode = ?, sources_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    nextColumn.title,
    nextColumn.type,
    nextColumn.width,
    nextColumn.settings.refreshInterval,
    nextColumn.settings.viewMode,
    JSON.stringify(nextColumn.sources),
    now,
    columnId
  );

  persistFeeds(nextColumn.sources);
  return getDeckState();
}

export function deleteColumn(columnId: string) {
  const db = getDb();
  db.prepare(`DELETE FROM columns_state WHERE id = ?`).run(columnId);
  normalizeColumnPositions();
  return getDeckState();
}

export function reorderColumns(columnIds: string[]) {
  const db = getDb();
  const update = db.prepare(`UPDATE columns_state SET position = ?, updated_at = ? WHERE id = ?`);
  const now = new Date().toISOString();

  columnIds.forEach((columnId, index) => {
    update.run(index, now, columnId);
  });

  return getDeckState();
}

export function addFeedToColumn(columnId: string, feed: FeedSource) {
  const column = getColumnById(columnId);
  if (!column) {
    throw new Error('Column not found');
  }

  return updateColumn(columnId, {
    sources: [...column.sources, feed],
  });
}

export function updateFeedInColumn(
  columnId: string,
  feedId: string,
  updates: Partial<FeedSource>
) {
  const column = getColumnById(columnId);
  if (!column) {
    throw new Error('Column not found');
  }

  const nextSources = column.sources.map((source) =>
    source.id === feedId ? { ...source, ...updates } : source
  );

  return updateColumn(columnId, { sources: nextSources });
}

export function removeFeedFromColumn(columnId: string, feedId: string) {
  const column = getColumnById(columnId);
  if (!column) {
    throw new Error('Column not found');
  }

  return updateColumn(columnId, {
    sources: column.sources.filter((source) => source.id !== feedId),
  });
}

export function saveFeed(feed: FeedSource) {
  persistFeeds([feed]);
  return getDeckState();
}

export function deleteSavedFeed(feedId: string) {
  const db = getDb();
  db.prepare(`DELETE FROM saved_feeds WHERE id = ?`).run(feedId);
  return getDeckState();
}

export function listSavedFeeds() {
  return getSavedFeeds();
}

export function recordFeedFetchResult(
  url: string,
  result: {
    title?: string | null;
    siteUrl?: string | null;
    fetchedAt?: string | null;
    error?: string | null;
  }
) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE saved_feeds
    SET title = COALESCE(?, title),
        site_url = COALESCE(?, site_url),
        last_fetched_at = COALESCE(?, last_fetched_at),
        last_error = ?,
        updated_at = ?
    WHERE url = ?
  `).run(
    result.title ?? null,
    result.siteUrl ?? null,
    result.fetchedAt ?? null,
    result.error ?? null,
    now,
    url
  );
}

function getColumns() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, title, type, width, position, refresh_interval, view_mode, sources_json
    FROM columns_state
    ORDER BY position ASC, created_at ASC
  `).all() as ColumnRow[];

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    type: row.type,
    width: row.width,
    sources: JSON.parse(row.sources_json) as FeedSource[],
    settings: {
      refreshInterval: row.refresh_interval,
      viewMode: row.view_mode,
    },
  }));
}

function getSavedFeeds() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, url, title, site_url, last_fetched_at, last_error
    FROM saved_feeds
    ORDER BY updated_at DESC, created_at DESC
  `).all() as FeedRow[];

  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    title: row.title,
    siteUrl: row.site_url ?? undefined,
    lastFetchedAt: row.last_fetched_at ?? undefined,
    lastError: row.last_error ?? undefined,
  }));
}

function getColumnById(columnId: string) {
  return getColumns().find((column) => column.id === columnId) ?? null;
}

function persistFeeds(feeds: FeedSource[]) {
  const db = getDb();
  const statement = db.prepare(`
    INSERT INTO saved_feeds (id, url, title, site_url, last_fetched_at, last_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      title = excluded.title,
      site_url = COALESCE(excluded.site_url, saved_feeds.site_url),
      last_fetched_at = COALESCE(excluded.last_fetched_at, saved_feeds.last_fetched_at),
      last_error = COALESCE(excluded.last_error, saved_feeds.last_error),
      updated_at = excluded.updated_at
  `);

  const now = new Date().toISOString();
  for (const feed of feeds) {
    statement.run(
      feed.id,
      feed.url,
      feed.title,
      feed.siteUrl ?? null,
      feed.lastFetchedAt ?? null,
      feed.lastError ?? null,
      now,
      now
    );
  }
}

function normalizeColumnPositions() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id
    FROM columns_state
    ORDER BY position ASC, created_at ASC
  `).all() as Array<{ id: string }>;

  const update = db.prepare(`UPDATE columns_state SET position = ?, updated_at = ? WHERE id = ?`);
  const now = new Date().toISOString();
  rows.forEach((row, index) => {
    update.run(index, now, row.id);
  });
}

function seedDefaultsIfNeeded() {
  const db = getDb();
  const countRow = db.prepare(`SELECT COUNT(*) as count FROM columns_state`).get() as {
    count: number;
  };

  if (countRow.count > 0) {
    return;
  }

  const now = new Date().toISOString();
  const insertColumn = db.prepare(`
    INSERT INTO columns_state (
      id, title, type, width, position, refresh_interval, view_mode, sources_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  DEFAULT_COLUMNS.forEach((column, index) => {
    insertColumn.run(
      column.id,
      column.title,
      column.type,
      column.width,
      index,
      column.settings.refreshInterval,
      column.settings.viewMode,
      JSON.stringify(column.sources),
      now,
      now
    );
  });

  persistFeeds(DEFAULT_SAVED_FEEDS);
}
