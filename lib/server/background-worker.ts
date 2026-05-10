import 'server-only';

import { getDefaultSettingsSnapshot } from '@/lib/settings-store';
import { getDb } from '@/lib/server/db';
import { getPersistedSettings } from '@/lib/server/settings-repository';
import { refreshSavedFeeds } from '@/lib/server/rss-ingestion';

const MIN_REFRESH_INTERVAL_MS = 60_000;
const WORKER_CHECK_INTERVAL_MS = 60_000;
const STARTUP_DELAY_MS = 10_000;
const DEFAULT_SERVER_PORT = '3001';

type BackgroundWorkerState = {
  started: boolean;
  running: boolean;
  lastAttemptAt: number;
  timer: NodeJS.Timeout | null;
  startupTimer: NodeJS.Timeout | null;
};

declare global {
  var __intellideckBackgroundWorker: BackgroundWorkerState | undefined;
}

function getWorkerState() {
  if (!globalThis.__intellideckBackgroundWorker) {
    globalThis.__intellideckBackgroundWorker = {
      started: false,
      running: false,
      lastAttemptAt: 0,
      timer: null,
      startupTimer: null,
    };
  }

  return globalThis.__intellideckBackgroundWorker;
}

function getRefreshIntervalMs() {
  const settings = getPersistedSettings(getDefaultSettingsSnapshot());
  return Math.max(
    MIN_REFRESH_INTERVAL_MS,
    (settings.defaultRefreshInterval || 10) * 60_000
  );
}

function getLatestFeedFetchAtMs() {
  const row = getDb().prepare(`
    SELECT MAX(last_fetched_at) AS latest
    FROM saved_feeds
    WHERE last_fetched_at IS NOT NULL
  `).get() as { latest: string | null } | undefined;

  const parsed = row?.latest ? Date.parse(row.latest) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function getTodayWarmupUrl() {
  const port = process.env.PORT || DEFAULT_SERVER_PORT;
  return `http://127.0.0.1:${port}/api/today`;
}

async function warmTodayCache() {
  try {
    const response = await fetch(getTodayWarmupUrl(), { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json() as { priorityItems?: unknown[] };
  } catch (error) {
    console.warn('[IntelliDeck worker] Today cache warmup failed:', error);
    return null;
  }
}

async function refreshTodaySummary(todayPayload: { priorityItems?: unknown[] } | null) {
  try {
    await fetch(`${getTodayWarmupUrl()}/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        priorityItems: todayPayload?.priorityItems ?? [],
      }),
    });
  } catch (error) {
    console.warn('[IntelliDeck worker] Today summary refresh failed:', error);
  }
}

async function runFeedRefreshIfDue(state: BackgroundWorkerState) {
  if (state.running) return;

  const intervalMs = getRefreshIntervalMs();
  const latestFeedFetchAt = getLatestFeedFetchAtMs();
  const lastWorkAt = Math.max(latestFeedFetchAt, state.lastAttemptAt);

  if (lastWorkAt && Date.now() - lastWorkAt < intervalMs) {
    return;
  }

  state.running = true;
  state.lastAttemptAt = Date.now();

  try {
    const result = await refreshSavedFeeds();
    console.log(
      `[IntelliDeck worker] Refreshed ${result.successfulFeeds}/${result.totalFeeds} feeds, processed ${result.totalArticles} items.`
    );
    const todayPayload = await warmTodayCache();
    await refreshTodaySummary(todayPayload);
  } catch (error) {
    console.warn('[IntelliDeck worker] Feed refresh failed:', error);
  } finally {
    state.running = false;
  }
}

export function startBackgroundWorker() {
  if (process.env.INTELLIDECK_DISABLE_BACKGROUND_WORKER === '1') return;

  const state = getWorkerState();
  if (state.started) return;

  state.started = true;

  const tick = () => {
    void runFeedRefreshIfDue(state);
  };

  state.startupTimer = setTimeout(tick, STARTUP_DELAY_MS);
  state.startupTimer.unref?.();

  state.timer = setInterval(tick, WORKER_CHECK_INTERVAL_MS);
  state.timer.unref?.();

  console.log('[IntelliDeck worker] Server-side feed worker started.');
}
