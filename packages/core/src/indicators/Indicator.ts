import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Where an indicator is rendered:
 * - `overlay`: drawn on top of the main price pane (e.g. SMA, EMA, Bollinger Bands)
 * - `pane`: drawn in its own sub-pane with an independent Y-axis (e.g. RSI, MACD)
 */
export type IndicatorPlacement = 'overlay' | 'pane';

/**
 * One computed output stream of an indicator. An indicator can return
 * multiple series (e.g. Bollinger Bands returns `upper`, `middle`, `lower`).
 *
 * `values` is aligned 1:1 with the input buffer (index 0 = buffer[0]).
 * Positions where the value is undefined (e.g. before the warmup period
 * is satisfied) contain `NaN`. Renderers must skip NaN values.
 */
export interface IndicatorSeries {
  name: string;
  values: Float64Array;
}

/**
 * Base class for price-series indicators. Subclasses implement `compute`
 * which reads from a candle buffer and returns one or more series.
 *
 * Hot render paths should call `computeCached` instead of `compute`: it
 * memoizes the result keyed on the buffer's `version`, so repeated calls
 * within a single data revision (e.g. on every render frame during a
 * pan/crosshair move) are O(1) instead of recomputing the whole series.
 * The cache invalidates automatically when the buffer mutates.
 */
export abstract class Indicator {
  /** Where the indicator renders (overlay vs. its own pane). */
  abstract readonly placement: IndicatorPlacement;

  /**
   * Stable human-readable identifier, e.g. `sma(20)` or `rsi(14)`. Used as
   * the cache key by the IndicatorRegistry and as a label in legends.
   */
  abstract get id(): string;

  /**
   * Read the buffer and return one or more aligned series. Every returned
   * Float64Array MUST have the same length as `buffer.length` so the
   * renderer can align values with candles index-for-index.
   */
  abstract compute(buffer: CandleBuffer): IndicatorSeries[];

  private _cache: { version: number; length: number; series: IndicatorSeries[] } | null = null;

  /**
   * Memoized wrapper around `compute`. Returns the same cached array
   * reference while the buffer's `version` and `length` are unchanged.
   * Use this on render paths; use `compute` directly to force a fresh
   * computation.
   */
  computeCached(buffer: CandleBuffer): IndicatorSeries[] {
    const version = buffer.version;
    const length = buffer.length;
    const cache = this._cache;
    if (cache && cache.version === version && cache.length === length) {
      return cache.series;
    }
    const series = this.compute(buffer);
    this._cache = { version, length, series };
    return series;
  }
}

/**
 * Create a Float64Array of the given length pre-filled with NaN. Used by
 * indicator implementations to mark "no value yet" positions during the
 * warmup period.
 */
export function nanArray(length: number): Float64Array {
  const arr = new Float64Array(length);
  arr.fill(NaN);
  return arr;
}
