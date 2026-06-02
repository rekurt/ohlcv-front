import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Simple Moving Average over the last `period` closing prices.
 * Renders as a line overlay on the main price pane.
 */
export class SMA extends Indicator {
  readonly placement: IndicatorPlacement = 'overlay';

  constructor(public readonly period: number) {
    super();
    if (!Number.isInteger(period) || period < 1) {
      throw new Error(`SMA period must be a positive integer, got ${period}`);
    }
  }

  get id(): string {
    return `sma(${this.period})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const out = nanArray(n);
    if (n === 0 || n < this.period) {
      return [{ name: 'sma', values: out }];
    }

    const view = buffer.sliceView(0, n);
    const close = view.close;

    // Running sum: primes with the first `period` closes, then slides.
    let sum = 0;
    for (let i = 0; i < this.period; i++) sum += close[i]!;
    out[this.period - 1] = sum / this.period;

    for (let i = this.period; i < n; i++) {
      sum += close[i]! - close[i - this.period]!;
      out[i] = sum / this.period;
    }

    return [{ name: 'sma', values: out }];
  }

  /**
   * Incremental tail patch. SMA at index `i` is just the mean of the
   * window `[i-period+1, i]`, all of which are input closes still present
   * in the buffer — no dependence on any prior output value. So we copy
   * the untouched prefix and recompute the single touched index directly
   * from its window. If `i` is in the warmup region (`i < period-1`) the
   * value stays NaN (already present in the copied prefix on updateLast,
   * or appended explicitly here).
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
      out[i] = NaN; // still warming up
      return [{ name: 'sma', values: out }];
    }

    const close = buffer.sliceView(0, n).close;
    let sum = 0;
    for (let j = i - p + 1; j <= i; j++) sum += close[j]!;
    out[i] = sum / p;

    return [{ name: 'sma', values: out }];
  }
}
