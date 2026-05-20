import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Bollinger Bands:
 *   middle = SMA(period)
 *   upper  = middle + stdDev * σ(close, period)
 *   lower  = middle - stdDev * σ(close, period)
 *
 * Renders as three overlay lines on the main price pane.
 *
 * Performance: O(n) total via two rolling sums (sum and sum of
 * squares). Stdev uses the population variance formula
 *   σ² = E[x²] − (E[x])²
 * applied to a sliding window. We clamp negative variance to zero —
 * it can only arise from float cancellation when the window is
 * effectively constant.
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

    const p = this.period;
    const invP = 1 / p;

    // Prime the window with the first `period` closes.
    let sum = 0;
    let sqSum = 0;
    for (let i = 0; i < p; i++) {
      const c = buffer.candleAt(i)!.c;
      sum += c;
      sqSum += c * c;
    }

    // First window ending at index p-1.
    {
      const mean = sum * invP;
      const variance = Math.max(0, sqSum * invP - mean * mean);
      const sigma = Math.sqrt(variance);
      middle[p - 1] = mean;
      upper[p - 1] = mean + this.stdDev * sigma;
      lower[p - 1] = mean - this.stdDev * sigma;
    }

    // Slide the window forward — drop the oldest close, add the newest.
    for (let i = p; i < n; i++) {
      const out = buffer.candleAt(i - p)!.c;
      const inc = buffer.candleAt(i)!.c;
      sum += inc - out;
      sqSum += inc * inc - out * out;

      const mean = sum * invP;
      const variance = Math.max(0, sqSum * invP - mean * mean);
      const sigma = Math.sqrt(variance);
      middle[i] = mean;
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
