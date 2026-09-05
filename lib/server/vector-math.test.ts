import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { cosineSimilarity, runningMean } from './vector-math';

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it('returns 0 when either vector is zero-length or empty', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([], [1])).toBe(0);
  });
});

describe('runningMean', () => {
  it('returns the new vector when count is 0', () => {
    expect(runningMean(null, [1, 2], 0)).toEqual([1, 2]);
  });
  it('incrementally averages', () => {
    expect(runningMean([0, 0], [2, 2], 1)).toEqual([1, 1]);
  });
});
