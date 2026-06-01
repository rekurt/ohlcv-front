import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Weighted Moving Average — linearly weights recent closes more
 * heavily. Weight of the i-th most recent close (1 = oldest in the
 * window) is `i`, so the divisor is `period*(period+1)/2`.
 *
 *   WMA = Σ(close_k * weight_k) / Σ(weight_k)
 *
 * Computed with the standard O(n) rolling-WMA recurrence:
 *   numerator_t   = numerator_{t-1} + period*close_t − sum_{t-1}
 *   sum_t         = sum_{t-1} + close_t − close_{t-period}
 * where `sum` is the plain rolling window sum.
 */
export class WMA extends Indicator {
  readonly placement: IndicatorPlacement = 'overlay';

  constructor(public readonly period: number) {
    super();
    if (!Number.isInteger(period) || period < 1) {
      throw new Error(`WMA period must be a positive integer, got ${period}`);
    }
  }

  get id(): string {
    return `wma(${this.period})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const out = nanArray(n);
    const p = this.period;
    if (n === 0 || n < p) return [{ name: 'wma', values: out }];

    const view = buffer.sliceView(0, n);
    const close = view.close;

    const divisor = (p * (p + 1)) / 2;

    // Prime the first window directly.
    let sum = 0; // plain window sum
    let numerator = 0; // weighted sum (weight 1..p)
    for (let i = 0; i < p; i++) {
      const c = close[i]!;
      sum += c;
      numerator += c * (i + 1);
    }
    out[p - 1] = numerator / divisor;

    for (let i = p; i < n; i++) {
      const incoming = close[i]!;
      const outgoing = close[i - p]!;
      numerator = numerator + p * incoming - sum;
      sum = sum + incoming - outgoing;
      out[i] = numerator / divisor;
    }

    return [{ name: 'wma', values: out }];
  }

  /**
   * Incremental tail patch. WMA at index `i` is a weighted mean of the
   * window `[i-period+1, i]` (oldest close weight 1 … newest weight p),
   * all input closes still in the buffer — no prior-output dependence.
   * Recompute the single touched index from its window directly. Warmup
   * indices (`i < period-1`) stay NaN.
   */
  protected override updateTail(
    buffer: CandleBuffer,
    prev: IndicatorSeries[],
    kind: 'append' | 'updateLast',
  ): IndicatorSeries[] | null {
    const n = buffer.length;
    const i = n - 1;
    const p = this.period;

    const prevValues = prev[0]!.values;
    const out = new Float64Array(n);
    out.set(kind === 'append' ? prevValues : prevValues.subarray(0, i));

    if (i < p - 1) {
      out[i] = NaN;
      return [{ name: 'wma', values: out }];
    }

    const close = buffer.sliceView(0, n).close;
    const divisor = (p * (p + 1)) / 2;
    let numerator = 0;
    // Weight 1 for the oldest close in the window, … p for the newest (close[i]).
    for (let w = 1; w <= p; w++) numerator += close[i - p + w]! * w;
    out[i] = numerator / divisor;

    return [{ name: 'wma', values: out }];
  }
}
