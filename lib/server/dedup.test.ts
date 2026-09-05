import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const nearestMock = vi.fn();
vi.mock('./article-vectors-repository', () => ({
  findNearestArticles: (...args: unknown[]) => nearestMock(...args),
}));

const createdAtById = new Map<string, string>();
vi.mock('./db', () => ({
  getDb: () => ({
    prepare: () => ({
      get: (id: string) => {
        const v = createdAtById.get(id);
        return v ? { created_at: v } : undefined;
      },
    }),
  }),
}));

import { findNearDuplicate, DEDUP_DISTANCE_THRESHOLD } from './dedup';

const NOW = Date.parse('2026-06-23T12:00:00Z');
const recent = '2026-06-23T06:00:00Z'; // 6h ago
const old = '2026-06-10T12:00:00Z'; // 13 days ago

beforeEach(() => { nearestMock.mockReset(); createdAtById.clear(); });

describe('findNearDuplicate', () => {
  it('returns the neighbour when within threshold and recent (excluding self)', () => {
    nearestMock.mockReturnValue([{ articleId: 'self', distance: 0 }, { articleId: 'twin', distance: 2.0 }]);
    createdAtById.set('twin', recent);
    expect(findNearDuplicate('self', [1, 0, 0], NOW)).toEqual({ articleId: 'twin', distance: 2.0 });
  });

  it('returns null when the neighbour is older than the window', () => {
    nearestMock.mockReturnValue([{ articleId: 'self', distance: 0 }, { articleId: 'twin', distance: 2.0 }]);
    createdAtById.set('twin', old);
    expect(findNearDuplicate('self', [1, 0, 0], NOW)).toBeNull();
  });

  it('returns null when the nearest non-self is above threshold', () => {
    nearestMock.mockReturnValue([{ articleId: 'self', distance: 0 }, { articleId: 'twin', distance: 5.0 }]);
    createdAtById.set('twin', recent);
    expect(findNearDuplicate('self', [1, 0, 0], NOW)).toBeNull();
  });

  it('returns null when only self is in the index', () => {
    nearestMock.mockReturnValue([{ articleId: 'self', distance: 0 }]);
    expect(findNearDuplicate('self', [1, 0, 0], NOW)).toBeNull();
  });

  it('returns null when the neighbour has no created_at', () => {
    nearestMock.mockReturnValue([{ articleId: 'twin', distance: 2.0 }]);
    expect(findNearDuplicate('self', [1, 0, 0], NOW)).toBeNull();
  });

  it('returns null (fail-open) when the lookup throws', () => {
    nearestMock.mockImplementation(() => { throw new Error('vec exploded'); });
    expect(findNearDuplicate('self', [1, 0, 0], NOW)).toBeNull();
  });

  it('exposes the measured threshold default', () => {
    expect(DEDUP_DISTANCE_THRESHOLD).toBe(3.75);
  });
});
