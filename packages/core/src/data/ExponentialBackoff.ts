/**
 * Exponential backoff policy with full jitter, suitable for WebSocket
 * reconnection. Each call to `nextDelay()` returns the delay (in ms)
 * before the next attempt, incrementing the internal attempt counter.
 *
 * Formula (full jitter, per AWS architecture blog):
 *     raw = min(maxDelay, baseDelay * 2^attempt)
 *     actual = random(0, raw)
 *
 * This reduces thundering-herd when many clients reconnect simultaneously
 * after the server comes back online.
 *
 * Reset the counter via `reset()` on successful connection.
 */
export interface ExponentialBackoffOptions {
  /** Base delay for the first retry, in milliseconds. Default: 500ms. */
  baseDelay?: number;
  /** Upper cap on the computed delay before jitter, in ms. Default: 30s. */
  maxDelay?: number;
  /**
   * Random number generator. Defaults to Math.random. Tests inject a
   * deterministic RNG so delays are predictable.
   */
  rng?: () => number;
}

export class ExponentialBackoff {
  private _attempts = 0;
  private readonly _baseDelay: number;
  private readonly _maxDelay: number;
  private readonly _rng: () => number;

  constructor(options: ExponentialBackoffOptions = {}) {
    this._baseDelay = options.baseDelay ?? 500;
    this._maxDelay = options.maxDelay ?? 30_000;
    this._rng = options.rng ?? Math.random;
    if (this._baseDelay <= 0) {
      throw new Error(`baseDelay must be positive, got ${this._baseDelay}`);
    }
    if (this._maxDelay < this._baseDelay) {
      throw new Error(
        `maxDelay (${this._maxDelay}) must be >= baseDelay (${this._baseDelay})`,
      );
    }
  }

  /** Number of attempts that have happened via `nextDelay`. */
  get attempts(): number {
    return this._attempts;
  }

  /**
   * Return the delay before the next attempt, then increment the counter.
   * Safe to call on a fresh instance (first delay uses attempt=0).
   */
  nextDelay(): number {
    const exp = Math.min(this._maxDelay, this._baseDelay * 2 ** this._attempts);
    this._attempts++;
    return this._rng() * exp;
  }

  /** Called after a successful connect — drops the counter back to zero. */
  reset(): void {
    this._attempts = 0;
  }
}
