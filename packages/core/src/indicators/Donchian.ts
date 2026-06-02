import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Donchian Channels — the highest high and lowest low over `period`
 * bars, plus their midline. The basis of turtle-trading breakouts.
 *
 *   upper  = highest(high, period)
 *   lower  = lowest(low, period)
 *   middle = (upper + lower) / 2
 *
 * Window extrema via monotonic deques → amortized O(1) per bar.
 * Three overlay series: upper, middle, lower.
 */
export class Donchian extends Indicator {
  readonly placement: IndicatorPlacement = 'overlay';

  constructor(public readonly period: number = 20) {
    super();
    if (!Number.isInteger(period) || period < 1) {
      throw new Error(`Donchian period must be a positive integer, got ${period}`);
    }
  }

  get id(): string {
    return `donchian(${this.period})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const upper = nanArray(n);
    const middle = nanArray(n);
    const lower = nanArray(n);
    const p = this.period;
    if (n === 0 || n < p) {
      return [
        { name: 'upper', values: upper },
        { name: 'middle', values: middle },
        { name: 'lower', values: lower },
      ];
    }

    const view = buffer.sliceView(0, n);
    const high = view.high;
    const low = view.low;
    const hiIdx: number[] = [];
    const loIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      while (hiIdx.length > 0 && high[hiIdx[hiIdx.length - 1]!]! <= high[i]!) hiIdx.pop();
      hiIdx.push(i);
      while (loIdx.length > 0 && low[loIdx[loIdx.length - 1]!]! >= low[i]!) loIdx.pop();
      loIdx.push(i);
      while (hiIdx.length > 0 && hiIdx[0]! <= i - p) hiIdx.shift();
      while (loIdx.length > 0 && loIdx[0]! <= i - p) loIdx.shift();
      if (i >= p - 1) {
        const hh = high[hiIdx[0]!]!;
        const ll = low[loIdx[0]!]!;
        upper[i] = hh;
        lower[i] = ll;
        middle[i] = (hh + ll) / 2;
      }
    }

    return [
      { name: 'upper', values: upper },
      { name: 'middle', values: middle },
      { name: 'lower', values: lower },
    ];
  }

  /**
   * Incremental tail patch. Channel at index `i` is the highest high /
   * lowest low over the window `[i-period+1, i]` (and their midpoint),
   * all input highs/lows still in the buffer — no prior-output
   * dependence. Rescan that single window for the touched index. Warmup
   * (`i < period-1`) leaves all three series NaN at `i`.
   */
  protected override updateTail(
    buffer: CandleBuffer,
    prev: IndicatorSeries[],
    kind: 'append' | 'updateLast',
  ): IndicatorSeries[] | null {
    const n = buffer.length;
    const i = n - 1;
    const p = this.period;

    const prevUpper = prev[0]!.values;
    const prevMiddle = prev[1]!.values;
    const prevLower = prev[2]!.values;
    const upper = new Float64Array(n);
    const middle = new Float64Array(n);
    const lower = new Float64Array(n);
    if (kind === 'append') {
      upper.set(prevUpper);
      middle.set(prevMiddle);
      lower.set(prevLower);
    } else {
      upper.set(prevUpper.subarray(0, i));
      middle.set(prevMiddle.subarray(0, i));
      lower.set(prevLower.subarray(0, i));
    }

    if (i < p - 1) {
      upper[i] = NaN;
      middle[i] = NaN;
      lower[i] = NaN;
      return [
        { name: 'upper', values: upper },
        { name: 'middle', values: middle },
        { name: 'lower', values: lower },
      ];
    }

    const view = buffer.sliceView(0, n);
    const high = view.high;
    const low = view.low;
    let hh = high[i - p + 1]!;
    let ll = low[i - p + 1]!;
    for (let j = i - p + 2; j <= i; j++) {
      const h = high[j]!;
      const l = low[j]!;
      if (h > hh) hh = h;
      if (l < ll) ll = l;
    }
    upper[i] = hh;
    lower[i] = ll;
    middle[i] = (hh + ll) / 2;

    return [
      { name: 'upper', values: upper },
      { name: 'middle', values: middle },
      { name: 'lower', values: lower },
    ];
  }
}
