import 'server-only';

import { getDefaultSettingsSnapshot } from '@/lib/settings-store';
import { getDb } from '@/lib/server/db';
import { getPersistedSettings } from '@/lib/server/settings-repository';
import { refreshSavedFeeds } from '@/lib/server/rss-ingestion';

const MIN_REFRESH_INTERVAL_MS = 60_000;
const WORKER_CHECK_INTERVAL_MS = 60_000;
const STARTUP_DELAY_MS = 10_000;

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
  } catch (error) {
    console.warn('[IntelliDeck worker] Feed refresh failed:', error);
  } finally {
    state.running = false;
  }
}

export function shouldStartBackgroundWorker(env: Partial<NodeJS.ProcessEnv> = process.env) {
  if (env.INTELLIDECK_DISABLE_BACKGROUND_WORKER === '1') return false;
  if (env.NEXT_PHASE === 'phase-production-build') return false;
  return true;
}

export function startBackgroundWorker() {
  if (!shouldStartBackgroundWorker()) return;

  const state = getWorkerState();
  if (state.started) return;

  state.started = true;

  // One-shot, idempotent backfill: merge existing EN/CN entity variants onto their
  // canonical rows. Cheap (scoped to the curated alias set); best-effort.
  void import('./entity-aliases')
    .then((m) => {
      const merged = m.mergeAliasedEntities();
      if (merged > 0) console.log(`[IntelliDeck worker] Merged ${merged} aliased entity rows.`);
    })
    .catch((err) => console.error('[IntelliDeck worker] entity alias backfill failed:', err));

  const tick = () => {
    void runFeedRefreshIfDue(state);
  };

  state.startupTimer = setTimeout(tick, STARTUP_DELAY_MS);
  state.startupTimer.unref?.();

  state.timer = setInterval(tick, WORKER_CHECK_INTERVAL_MS);
  state.timer.unref?.();

  console.log('[IntelliDeck worker] Server-side feed worker started.');
}
