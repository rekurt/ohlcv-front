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

    // Running sum: primes with the first `period` closes, then slides.
    let sum = 0;
    for (let i = 0; i < this.period; i++) sum += buffer.candleAt(i)!.c;
    out[this.period - 1] = sum / this.period;

    for (let i = this.period; i < n; i++) {
      sum += buffer.candleAt(i)!.c - buffer.candleAt(i - this.period)!.c;
      out[i] = sum / this.period;
    }

    return [{ name: 'sma', values: out }];
  }
}
