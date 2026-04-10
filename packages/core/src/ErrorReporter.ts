import type { ChartError, ChartErrorWhere } from './types';

/**
 * Thin wrapper around the user-provided `onError` callback. Ensures every
 * error that reaches a consumer is a proper `ChartError` structure:
 * - non-Error throwables are wrapped in `new Error(String(x))`
 * - handler exceptions are swallowed so a broken `onError` can't cascade
 * - if no handler is configured, errors fall through to `console.warn`
 *   (never silently dropped, unlike the old `catch {}` pattern)
 */
export class ErrorReporter {
  private readonly _onError: ((err: ChartError) => void) | undefined;

  constructor(onError?: (err: ChartError) => void) {
    this._onError = onError;
  }

  report(where: ChartErrorWhere, error: unknown, fatal = false): void {
    const wrapped: ChartError = {
      where,
      error: error instanceof Error ? error : new Error(String(error)),
      fatal,
    };
    if (this._onError) {
      try {
        this._onError(wrapped);
      } catch {
        // Swallow handler errors — we never want reporting to throw.
      }
      return;
    }
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn(`[ohlcv] ${where}${fatal ? ' (fatal)' : ''}:`, wrapped.error);
    }
  }
}
