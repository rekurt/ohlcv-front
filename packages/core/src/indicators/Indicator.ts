import type { CandleBuffer } from '../data/CandleBuffer';
import type { PriceScaleSide } from '../interaction/Viewport';

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
   * Which price scale an `overlay`-placement indicator projects through
   * (B2). `'right'` (the default when undefined) is the primary scale
   * shared with the price series; `'left'` binds the indicator to the
   * independent secondary scale, which the chart enables — reserving the
   * left axis strip — only while at least one indicator requests it.
   *
   * Ignored for `pane`-placement indicators (they own their sub-pane axis).
   * Subclasses opt in by overriding this getter (or declaring a matching
   * readonly field).
   */
  readonly priceScaleId?: PriceScaleSide;

  /**
   * Read the buffer and return one or more aligned series. Every returned
   * Float64Array MUST have the same length as `buffer.length` so the
   * renderer can align values with candles index-for-index.
   */
  abstract compute(buffer: CandleBuffer): IndicatorSeries[];

  private _cache: {
    buffer: CandleBuffer;
    version: number;
    length: number;
    firstTime: number;
    series: IndicatorSeries[];
  } | null = null;

  /**
   * Optional incremental-update hook. When implemented, `computeCached`
   * calls it instead of the full `compute` for the two cheap realtime
   * mutations — an in-place `updateLast` (length unchanged) or a single
   * `append` (length grew by one) — provided the buffer head has not
   * moved (same `firstTime`).
   *
   * `kind` is `'updateLast'` when only the final candle changed, or
   * `'append'` when exactly one candle was added.
   *
   * Contract:
   * - The implementation MUST return BRAND-NEW `Float64Array`s. Copy
   *   `prev[k].values` into a fresh array of the correct length and
   *   recompute only the affected tail. NEVER mutate the arrays inside
   *   `prev`: a caller may still hold a reference to the previously
   *   returned series (e.g. a renderer captured it last frame), and
   *   mutating it in place would corrupt that snapshot.
   * - Return `null` to fall back to a full `compute` (e.g. when the
   *   affected index falls inside the warmup/seed region where the
   *   incremental recurrence is not valid).
   *
   * Only implement this for indicators whose tail value is a pure
   * function of the input candles plus PREVIOUS OUTPUT values already
   * present in `prev` — i.e. no hidden recursive state (Wilder
   * smoothing, running trend flips, etc.) that an incremental step
   * cannot reconstruct. Indicators without this hook always take the
   * full-recompute path and stay correct automatically.
   */
  protected updateTail?(
    buffer: CandleBuffer,
    prev: IndicatorSeries[],
    kind: 'append' | 'updateLast',
  ): IndicatorSeries[] | null;

  /**
   * Memoized wrapper around `compute`. Returns the same cached array
   * reference while the SAME buffer's `version` and `length` are unchanged.
   * The buffer identity is part of the key so reusing one indicator
   * instance across two buffers (or swapping a chart's buffer) never
   * returns another buffer's stale series — important right after init when
   * distinct buffers can share `version: 0` and the same length.
   *
   * When the data did change but only via a single realtime tick — an
   * `updateLast` (same length) or one `append` (length + 1) on the SAME
   * buffer with an unmoved head (`firstTime` unchanged) — and the
   * subclass provides an `updateTail` hook, the tail is patched in O(tail)
   * instead of recomputing the whole series in O(n). `firstTime` is part
   * of the key precisely so a `prepend`/`evictHead` (which shifts the head
   * and renumbers every index) can never be mistaken for an append/update
   * and forces a full recompute.
   *
   * Use this on render paths; use `compute` directly to force a fresh
   * computation.
   */
  computeCached(buffer: CandleBuffer): IndicatorSeries[] {
    const version = buffer.version;
    const length = buffer.length;
    const firstTime = buffer.firstTime();
    const c = this._cache;
    if (c && c.buffer === buffer && c.version === version && c.length === length) {
      return c.series;
    }
    if (c && c.buffer === buffer && c.firstTime === firstTime && this.updateTail) {
      const kind =
        length === c.length ? 'updateLast' : length === c.length + 1 ? 'append' : null;
      if (kind) {
        const updated = this.updateTail(buffer, c.series, kind);
        if (updated) {
          this._cache = { buffer, version, length, firstTime, series: updated };
          return updated;
        }
      }
    }
    const series = this.compute(buffer);
    this._cache = { buffer, version, length, firstTime, series };
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
