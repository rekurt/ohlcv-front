import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Commodity Channel Index (Lambert 1980) — measures the deviation of
 * the typical price from its moving average, normalized by mean
 * absolute deviation:
 *
 *   tp[i] = (h[i] + l[i] + c[i]) / 3
 *   sma  = SMA(tp, period)
 *   mad  = (1/period) * Σ |tp[i-j] - sma|       (mean absolute deviation)
 *   CCI  = (tp - sma) / (0.015 * mad)
 *
 * The 0.015 constant scales the indicator so ~70% of values fall in
 * `[-100, 100]`. Renders in its own pane.
 *
 * Implementation: SMA via rolling sum (O(n)); MAD recomputed per
 * window (O(n*period)) — MAD has no efficient online formula. The
 * default period (20) is small so this is fine in practice.
 */
export class CCI extends Indicator {
  readonly placement: IndicatorPlacement = 'pane';

  constructor(public readonly period: number = 20) {
    super();
    if (!Number.isInteger(period) || period < 2) {
      throw new Error(`CCI period must be an integer >= 2, got ${period}`);
    }
  }

  get id(): string {
    return `cci(${this.period})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const out = nanArray(n);
    if (n === 0 || n < this.period) return [{ name: 'cci', values: out }];

    const p = this.period;
    const view = buffer.sliceView(0, n);
    const high = view.high;
    const low = view.low;
    const close = view.close;
    const tp = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      tp[i] = (high[i]! + low[i]! + close[i]!) / 3;
    }

    let sum = 0;
    for (let i = 0; i < p; i++) sum += tp[i]!;

    const writeAt = (i: number) => {
      const mean = sum / p;
      let mad = 0;
      for (let j = i - p + 1; j <= i; j++) mad += Math.abs(tp[j]! - mean);
      mad /= p;
      out[i] = mad === 0 ? 0 : (tp[i]! - mean) / (0.015 * mad);
    };

    writeAt(p - 1);
    for (let i = p; i < n; i++) {
      sum += tp[i]! - tp[i - p]!;
      writeAt(i);
    }

    return [{ name: 'cci', values: out }];
  }
}
