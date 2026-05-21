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
 * Fixed Y-axis range for a sub-pane indicator (e.g. RSI/Stochastic are
 * bounded to [0, 100]). When an indicator returns `null` (the default),
 * the sub-pane auto-scales from the visible series values instead.
 */
export interface PaneRange {
  min: number;
  max: number;
}

/**
 * Base class for price-series indicators. Subclasses implement `_compute`
 * which reads from a candle buffer and returns one or more series.
 *
 * `compute` is a memoizing wrapper around `_compute`: it caches the result
 * keyed on the buffer's `version`, so calling it repeatedly within a single
 * data revision (e.g. on every render frame during a pan/crosshair move)
 * is O(1) instead of recomputing the whole series. The cache invalidates
 * automatically when the buffer mutates.
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
   * Fixed Y-axis range for the indicator's sub-pane, or `null` to auto-scale
   * from visible values. Override in bounded oscillators (RSI, Stochastic).
   * Only consulted for `placement: 'pane'` indicators.
   */
  get paneRange(): PaneRange | null {
    return null;
  }

  /**
   * Reference levels drawn as faint horizontal guides inside the sub-pane
   * (e.g. RSI 30/70, Stochastic 20/80). Only consulted for `'pane'`
   * indicators. Defaults to none.
   */
  get referenceLines(): number[] {
    return [];
  }

  private _cache: { version: number; length: number; series: IndicatorSeries[] } | null = null;

  /**
   * Memoized public entry point. Returns the same cached array reference
   * while the buffer's `version` and `length` are unchanged.
   */
  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const version = buffer.version;
    const length = buffer.length;
    const cache = this._cache;
    if (cache && cache.version === version && cache.length === length) {
      return cache.series;
    }
    const series = this._compute(buffer);
    this._cache = { version, length, series };
    return series;
  }

  /**
   * Read the buffer and return one or more aligned series. Every returned
   * Float64Array MUST have the same length as `buffer.length` so the
   * renderer can align values with candles index-for-index.
   */
  protected abstract _compute(buffer: CandleBuffer): IndicatorSeries[];
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
