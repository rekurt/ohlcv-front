import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Williams %R — momentum oscillator that maps the current close to its
 * position within the period's high/low range:
 *
 *   %R = (highestHigh − close) / (highestHigh − lowestLow) * −100
 *
 * Output is in `[−100, 0]`. Values near −20 signal overbought, near
 * −80 oversold. Inverse of Stochastic %K (sign and scale).
 *
 * Implemented with two O(n) monotonic deques (one for high, one for
 * low) so each window slide costs amortized O(1) instead of O(period).
 */
export class WilliamsR extends Indicator {
  readonly placement: IndicatorPlacement = 'pane';

  constructor(public readonly period: number = 14) {
    super();
    if (!Number.isInteger(period) || period < 2) {
      throw new Error(`WilliamsR period must be an integer >= 2, got ${period}`);
    }
  }

  get id(): string {
    return `williamsr(${this.period})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const out = nanArray(n);
    if (n === 0 || n < this.period) return [{ name: 'williamsr', values: out }];

    const p = this.period;
    const view = buffer.sliceView(0, n);
    const high = view.high;
    const low = view.low;
    const close = view.close;
    // Monotonic deques of indices into the buffer. `highIdx[0]` is the
    // index of the current window maximum; `lowIdx[0]` the minimum.
    const highIdx: number[] = [];
    const lowIdx: number[] = [];

    for (let i = 0; i < n; i++) {
      while (highIdx.length > 0 && high[highIdx[highIdx.length - 1]!]! <= high[i]!) {
        highIdx.pop();
      }
      highIdx.push(i);
      while (lowIdx.length > 0 && low[lowIdx[lowIdx.length - 1]!]! >= low[i]!) {
        lowIdx.pop();
      }
      lowIdx.push(i);

      // Drop indices that have fallen out of the window.
      while (highIdx.length > 0 && highIdx[0]! <= i - p) highIdx.shift();
      while (lowIdx.length > 0 && lowIdx[0]! <= i - p) lowIdx.shift();

      if (i >= p - 1) {
        const hh = high[highIdx[0]!]!;
        const ll = low[lowIdx[0]!]!;
        const range = hh - ll;
        // If the window is flat (range == 0), Williams %R is undefined;
        // emit −50 (mid-range) rather than NaN so the line stays
        // continuous on the chart.
        out[i] = range === 0 ? -50 : ((hh - close[i]!) / range) * -100;
      }
    }

    return [{ name: 'williamsr', values: out }];
  }
}
