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

    // Seed with SMA of the first `period` closes
    let seed = 0;
    for (let i = 0; i < this.period; i++) seed += buffer.candleAt(i)!.c;
    seed /= this.period;
    out[this.period - 1] = seed;

    const k = 2 / (this.period + 1);
    let prev = seed;
    for (let i = this.period; i < n; i++) {
      const close = buffer.candleAt(i)!.c;
      const value = close * k + prev * (1 - k);
      out[i] = value;
      prev = value;
    }

    return [{ name: 'ema', values: out }];
  }
}
