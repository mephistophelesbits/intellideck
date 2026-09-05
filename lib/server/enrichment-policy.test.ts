import { describe, it, expect } from 'vitest';
import { shouldLlmEnrich, ENRICHMENT_LLM_MAX_AGE_MS } from './enrichment-policy';

describe('shouldLlmEnrich', () => {
  const now = Date.parse('2026-06-17T12:00:00.000Z');

  it('enriches a fresh article', () => {
    expect(shouldLlmEnrich('2026-06-17T10:00:00.000Z', now)).toBe(true);
  });

  it('enriches an article right at the age boundary', () => {
    const atBoundary = new Date(now - ENRICHMENT_LLM_MAX_AGE_MS).toISOString();
    expect(shouldLlmEnrich(atBoundary, now)).toBe(true);
  });

  it('skips an article older than the window (the post-outage backlog case)', () => {
    const stale = new Date(now - ENRICHMENT_LLM_MAX_AGE_MS - 1000).toISOString();
    expect(shouldLlmEnrich(stale, now)).toBe(false);
  });

  it('skips a 2-day-old backlog article', () => {
    expect(shouldLlmEnrich('2026-06-15T01:00:00.000Z', now)).toBe(false);
  });

  it('defaults to enriching when the timestamp is missing or unparseable', () => {
    expect(shouldLlmEnrich(null, now)).toBe(true);
    expect(shouldLlmEnrich(undefined, now)).toBe(true);
    expect(shouldLlmEnrich('not-a-date', now)).toBe(true);
  });
});
