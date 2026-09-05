import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/settings-store', () => ({
  getDefaultSettingsSnapshot: () => ({ defaultRefreshInterval: 10 }),
}));
vi.mock('@/lib/server/db', () => ({
  getDb: () => ({ prepare: () => ({ get: () => ({ latest: null }) }) }),
}));
vi.mock('@/lib/server/settings-repository', () => ({
  getPersistedSettings: (settings: unknown) => settings,
}));
vi.mock('@/lib/server/rss-ingestion', () => ({
  refreshSavedFeeds: vi.fn(),
}));

describe('shouldStartBackgroundWorker', () => {
  it('does not start during Next production build', async () => {
    const { shouldStartBackgroundWorker } = await import('./background-worker');

    expect(shouldStartBackgroundWorker({ NEXT_PHASE: 'phase-production-build' })).toBe(false);
  });

  it('does not start when explicitly disabled', async () => {
    const { shouldStartBackgroundWorker } = await import('./background-worker');

    expect(shouldStartBackgroundWorker({ INTELLIDECK_DISABLE_BACKGROUND_WORKER: '1' })).toBe(false);
  });

  it('starts in normal runtime by default', async () => {
    const { shouldStartBackgroundWorker } = await import('./background-worker');

    expect(shouldStartBackgroundWorker({})).toBe(true);
  });
});
