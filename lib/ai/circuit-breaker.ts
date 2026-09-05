// A minimal consecutive-failure circuit breaker.
//
// Why this exists: IntelliDeck's article enrichment runs every LLM call through a
// single serialized queue. Before this, a hung/incompatible Ollama model (e.g. a
// `gemma4` model that returns empty via /api/generate, or a wedged runner) would make
// every call block for the full request timeout, freezing story assignment for hours
// or days. The breaker makes calls fail FAST once the provider is clearly unhealthy,
// so the queue drains (falling back to deterministic paths) and recovers on its own.

export interface CircuitBreaker {
  /** True if a call should be attempted (closed, or half-open trial). */
  shouldAllow(): boolean;
  recordSuccess(): void;
  recordFailure(): void;
  /** Manually close the breaker — use after fixing an underlying misconfiguration. */
  reset(): void;
  /** Open = currently short-circuiting calls. */
  readonly isOpen: boolean;
}

export interface CircuitBreakerOptions {
  /** Consecutive failures before the breaker opens. */
  failureThreshold?: number;
  /** How long to stay open before allowing a half-open trial. */
  cooldownMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export function createCircuitBreaker(options: CircuitBreakerOptions = {}): CircuitBreaker {
  const failureThreshold = options.failureThreshold ?? 4;
  const cooldownMs = options.cooldownMs ?? 30_000;
  const now = options.now ?? Date.now;

  let consecutiveFailures = 0;
  let openedAt = 0; // 0 = not open

  function open(): boolean {
    return openedAt !== 0;
  }

  return {
    get isOpen() {
      return open();
    },

    shouldAllow() {
      if (!open()) return true;
      // Half-open: after the cooldown, allow a single trial through.
      return now() - openedAt >= cooldownMs;
    },

    recordSuccess() {
      consecutiveFailures = 0;
      openedAt = 0;
    },

    recordFailure() {
      consecutiveFailures += 1;
      if (consecutiveFailures >= failureThreshold) {
        // Re-stamp openedAt so a failed half-open trial restarts the cooldown.
        openedAt = now();
      }
    },

    reset() {
      consecutiveFailures = 0;
      openedAt = 0;
    },
  };
}
