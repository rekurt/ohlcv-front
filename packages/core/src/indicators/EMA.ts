import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Exponential Moving Average with multiplier k = 2/(period+1).
 *
 * Convention: seeded at index `period-1` with the SMA of the first
 * `period` closes, then continues via recurrence
 *     ema[i] = close[i] * k + ema[i-1] * (1-k)
 *
 * Renders as a line overlay on the main price pane.
 */
export class EMA extends Indicator {
  readonly placement: IndicatorPlacement = 'overlay';

  constructor(public readonly period: number) {
    super();
    if (!Number.isInteger(period) || period < 2) {
      throw new Error(`EMA period must be an integer >= 2, got ${period}`);
    }
  }

  get id(): string {
    return `ema(${this.period})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const out = nanArray(n);
    if (n === 0 || n < this.period) {
      return [{ name: 'ema', values: out }];
    }

    const view = buffer.sliceView(0, n);
    const close = view.close;

    // Seed with SMA of the first `period` closes
    let seed = 0;
    for (let i = 0; i < this.period; i++) seed += close[i]!;
    seed /= this.period;
    out[this.period - 1] = seed;

    const k = 2 / (this.period + 1);
    let prev = seed;
    for (let i = this.period; i < n; i++) {
      const value = close[i]! * k + prev * (1 - k);
      out[i] = value;
      prev = value;
    }

    return [{ name: 'ema', values: out }];
  }

  /**
   * Incremental tail patch. The EMA recurrence
   *   out[i] = close[i]*k + out[i-1]*(1-k)
   * needs only `close[i]` and the already-computed `out[i-1]`, so a tick
   * that touches index `i` recomputes in O(1) — as long as `i` lies past
   * the seed (`i > period-1`). If the touched index falls on or before
   * the seed (`i <= period-1`) the value depends on the SMA-of-first-
   * `period`-closes seed rather than a prior EMA, which an incremental
   * step can't reconstruct, so we return null to force a full recompute.
   */
  protected override updateTail(
    buffer: CandleBuffer,
    prev: IndicatorSeries[],
    kind: 'append' | 'updateLast',
  ): IndicatorSeries[] | null {
    const n = buffer.length;
    const i = n - 1; // touched index (new last on append, changed last on updateLast)
    // Seed region (and the warmup NaNs before it) can't be patched incrementally.
    if (i <= this.period - 1) return null;

    const prevValues = prev[0]!.values;
    const out = new Float64Array(n);
    // Copy everything that is unchanged: indices [0, i). On updateLast that's
    // prevValues[0..i); on append prevValues has length i (== n-1) and we copy it whole.
    out.set(kind === 'append' ? prevValues : prevValues.subarray(0, i));

    const k = 2 / (this.period + 1);
    const close = buffer.sliceView(0, n).close;
    out[i] = close[i]! * k + out[i - 1]! * (1 - k);

    return [{ name: 'ema', values: out }];
  }
}
