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

    const divisor = (p * (p + 1)) / 2;

    // Prime the first window directly.
    let sum = 0; // plain window sum
    let numerator = 0; // weighted sum (weight 1..p)
    for (let i = 0; i < p; i++) {
      const c = buffer.candleAt(i)!.c;
      sum += c;
      numerator += c * (i + 1);
    }
    out[p - 1] = numerator / divisor;

    for (let i = p; i < n; i++) {
      const incoming = buffer.candleAt(i)!.c;
      const outgoing = buffer.candleAt(i - p)!.c;
      numerator = numerator + p * incoming - sum;
      sum = sum + incoming - outgoing;
      out[i] = numerator / divisor;
    }

    return [{ name: 'wma', values: out }];
  }
}
