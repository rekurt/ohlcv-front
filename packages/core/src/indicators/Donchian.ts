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

    const hiIdx: number[] = [];
    const loIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      const c = buffer.candleAt(i)!;
      while (hiIdx.length > 0 && buffer.candleAt(hiIdx[hiIdx.length - 1]!)!.h <= c.h) hiIdx.pop();
      hiIdx.push(i);
      while (loIdx.length > 0 && buffer.candleAt(loIdx[loIdx.length - 1]!)!.l >= c.l) loIdx.pop();
      loIdx.push(i);
      while (hiIdx.length > 0 && hiIdx[0]! <= i - p) hiIdx.shift();
      while (loIdx.length > 0 && loIdx[0]! <= i - p) loIdx.shift();
      if (i >= p - 1) {
        const hh = buffer.candleAt(hiIdx[0]!)!.h;
        const ll = buffer.candleAt(loIdx[0]!)!.l;
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
}
