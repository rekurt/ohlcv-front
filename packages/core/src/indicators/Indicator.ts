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
 * Compute is intended to be pure — caching/incrementality is a future
 * responsibility of an IndicatorRegistry wrapper (not yet implemented).
 */
export abstract class Indicator {
  /** Where the indicator renders (overlay vs. its own pane). */
  abstract readonly placement: IndicatorPlacement;

  /**
   * Stable human-readable identifier, e.g. `sma(20)` or `rsi(14)`. Used as
   * the cache key by future IndicatorRegistry and as a label in legends.
   */
  abstract get id(): string;

  /**
   * Read the buffer and return one or more aligned series. Every returned
   * Float64Array MUST have the same length as `buffer.length` so the
   * renderer can align values with candles index-for-index.
   */
  abstract compute(buffer: CandleBuffer): IndicatorSeries[];
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
