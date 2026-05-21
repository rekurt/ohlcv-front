import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Average True Range — Wilder's measure of volatility.
 *
 *   TR_i = max(high - low, |high - prevClose|, |low - prevClose|)
 *   ATR_i = Wilder smoothing of TR (seed with SMA over first `period`)
 *
 * Placement is `'pane'` — ATR is a raw volatility number, not a
 * price level.
 */
export class ATR extends Indicator {
  readonly placement: IndicatorPlacement = 'pane';

  constructor(public readonly period: number = 14) {
    super();
    if (!Number.isInteger(period) || period < 2) {
      throw new Error(`ATR period must be an integer >= 2, got ${period}`);
    }
  }

  get id(): string {
    return `atr(${this.period})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const atr = nanArray(n);
    if (n <= this.period) return [{ name: 'atr', values: atr }];

    // Build TR first. TR[0] is undefined (no previous close).
    const tr = new Float64Array(n);
    tr[0] = NaN;
    for (let i = 1; i < n; i++) {
      const cur = buffer.candleAt(i)!;
      const prev = buffer.candleAt(i - 1)!;
      const range = cur.h - cur.l;
      const hc = Math.abs(cur.h - prev.c);
      const lc = Math.abs(cur.l - prev.c);
      tr[i] = Math.max(range, hc, lc);
    }

    // Seed ATR at index `period` with SMA of TR[1..period]
    let sum = 0;
    for (let i = 1; i <= this.period; i++) sum += tr[i]!;
    let prev = sum / this.period;
    atr[this.period] = prev;

    // Wilder smoothing
    for (let i = this.period + 1; i < n; i++) {
      prev = (prev * (this.period - 1) + tr[i]!) / this.period;
      atr[i] = prev;
    }

    return [{ name: 'atr', values: atr }];
  }
}
