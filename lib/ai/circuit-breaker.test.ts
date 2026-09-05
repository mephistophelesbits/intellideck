import { describe, it, expect } from 'vitest';
import { createCircuitBreaker } from './circuit-breaker';

describe('createCircuitBreaker', () => {
  it('stays closed and allows calls until the failure threshold', () => {
    const cb = createCircuitBreaker({ failureThreshold: 3 });
    expect(cb.shouldAllow()).toBe(true);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen).toBe(false);
    expect(cb.shouldAllow()).toBe(true);
  });

  it('opens after N consecutive failures and short-circuits', () => {
    const t = 1000;
    const cb = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 5000, now: () => t });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen).toBe(true);
    expect(cb.shouldAllow()).toBe(false); // within cooldown
  });

  it('allows a half-open trial after the cooldown elapses', () => {
    let t = 1000;
    const cb = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 5000, now: () => t });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.shouldAllow()).toBe(false);
    t += 5000;
    expect(cb.shouldAllow()).toBe(true); // half-open trial permitted
  });

  it('a successful call closes the breaker and resets the counter', () => {
    const t = 1000;
    const cb = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 5000, now: () => t });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen).toBe(true);
    cb.recordSuccess();
    expect(cb.isOpen).toBe(false);
    expect(cb.shouldAllow()).toBe(true);
  });

  it('a failed half-open trial restarts the cooldown', () => {
    let t = 1000;
    const cb = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 5000, now: () => t });
    cb.recordFailure();
    cb.recordFailure();
    t += 5000;
    expect(cb.shouldAllow()).toBe(true); // trial allowed
    cb.recordFailure();                   // trial fails -> re-open
    expect(cb.shouldAllow()).toBe(false);
    t += 4999;
    expect(cb.shouldAllow()).toBe(false); // cooldown restarted from the trial failure
    t += 1;
    expect(cb.shouldAllow()).toBe(true);
  });

  it('an intermittent failure below threshold does not open it', () => {
    const cb = createCircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordSuccess(); // resets
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen).toBe(false);
  });
});
