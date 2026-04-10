import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Bollinger Bands:
 *   middle = SMA(period)
 *   upper  = middle + stdDev * σ(close, period)
 *   lower  = middle - stdDev * σ(close, period)
 *
 * Renders as three overlay lines on the main price pane.
 */
export class BollingerBands extends Indicator {
  readonly placement: IndicatorPlacement = 'overlay';

  constructor(
    public readonly period: number = 20,
    public readonly stdDev: number = 2,
  ) {
    super();
    if (!Number.isInteger(period) || period < 2) {
      throw new Error(`BollingerBands period must be an integer >= 2, got ${period}`);
    }
    if (!Number.isFinite(stdDev) || stdDev <= 0) {
      throw new Error(`BollingerBands stdDev must be a positive number, got ${stdDev}`);
    }
  }

  get id(): string {
    return `bb(${this.period},${this.stdDev})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const upper = nanArray(n);
    const middle = nanArray(n);
    const lower = nanArray(n);

    if (n === 0 || n < this.period) {
      return [
        { name: 'upper', values: upper },
        { name: 'middle', values: middle },
        { name: 'lower', values: lower },
      ];
    }

    // For each window ending at i (≥ period-1), compute mean and stdev.
    // Implemented as O(n*period) for clarity; O(n) incremental with
    // Welford's algorithm is a future optimization.
    for (let i = this.period - 1; i < n; i++) {
      let sum = 0;
      for (let j = i - this.period + 1; j <= i; j++) {
        sum += buffer.candleAt(j)!.c;
      }
      const mean = sum / this.period;
      middle[i] = mean;

      let sqSum = 0;
      for (let j = i - this.period + 1; j <= i; j++) {
        const diff = buffer.candleAt(j)!.c - mean;
        sqSum += diff * diff;
      }
      const sigma = Math.sqrt(sqSum / this.period);

      upper[i] = mean + this.stdDev * sigma;
      lower[i] = mean - this.stdDev * sigma;
    }

    return [
      { name: 'upper', values: upper },
      { name: 'middle', values: middle },
      { name: 'lower', values: lower },
    ];
  }
}
