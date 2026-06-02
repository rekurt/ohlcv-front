import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Classic floor-trader pivot points, computed from the **previous**
 * period's high/low/close. The pivot and four support/resistance
 * levels become horizontal-ish overlays on the main pane.
 *
 *   pivot = (prevH + prevL + prevC) / 3
 *   R1    = 2*pivot − prevL          S1 = 2*pivot − prevH
 *   R2    = pivot + (prevH − prevL)  S2 = pivot − (prevH − prevL)
 *
 * The `period` field is in **seconds** — the pivot recomputes when
 * `floor(candle.t / period)` changes. Defaults to 86_400 (daily
 * pivots; the most common for intraday charts on liquid markets).
 *
 * All five series are emitted in render order: pivot, R1, R2, S1, S2.
 * The first period's worth of candles is NaN (no "previous" yet).
 */
export class PivotPoints extends Indicator {
  readonly placement: IndicatorPlacement = 'overlay';

  constructor(public readonly period: number = 86_400) {
    super();
    if (!Number.isFinite(period) || period <= 0) {
      throw new Error(`PivotPoints period must be a positive number, got ${period}`);
    }
  }

  get id(): string {
    return `pp(${this.period})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const pivot = nanArray(n);
    const r1 = nanArray(n);
    const r2 = nanArray(n);
    const s1 = nanArray(n);
    const s2 = nanArray(n);
    if (n === 0) {
      return [
        { name: 'pivot', values: pivot },
        { name: 'r1', values: r1 },
        { name: 'r2', values: r2 },
        { name: 's1', values: s1 },
        { name: 's2', values: s2 },
      ];
    }

    const view = buffer.sliceView(0, n);
    const high = view.high;
    const low = view.low;
    const close = view.close;
    const time = view.time;

    // Walk forward, tracking the high/low/close of the current period.
    // When the period bucket changes, snapshot the previous bucket's
    // HLC, compute pivots, and use them until the next bucket flip.
    let bucketHigh = -Infinity;
    let bucketLow = Infinity;
    let bucketClose = NaN;
    let bucket = -1;
    let pivPivot = NaN;
    let pivR1 = NaN;
    let pivR2 = NaN;
    let pivS1 = NaN;
    let pivS2 = NaN;

    for (let i = 0; i < n; i++) {
      const ch = high[i]!;
      const cl = low[i]!;
      const cc = close[i]!;
      const b = Math.floor(time[i]! / this.period);
      if (b !== bucket) {
        // Bucket flipped — finalize the prior bucket's pivots (if any).
        if (bucket !== -1 && Number.isFinite(bucketHigh) && Number.isFinite(bucketLow)) {
          pivPivot = (bucketHigh + bucketLow + bucketClose) / 3;
          pivR1 = 2 * pivPivot - bucketLow;
          pivS1 = 2 * pivPivot - bucketHigh;
          pivR2 = pivPivot + (bucketHigh - bucketLow);
          pivS2 = pivPivot - (bucketHigh - bucketLow);
        }
        bucket = b;
        bucketHigh = ch;
        bucketLow = cl;
        bucketClose = cc;
      } else {
        if (ch > bucketHigh) bucketHigh = ch;
        if (cl < bucketLow) bucketLow = cl;
        bucketClose = cc;
      }
      // Write current bucket's pivots (derived from the PREVIOUS bucket).
      pivot[i] = pivPivot;
      r1[i] = pivR1;
      r2[i] = pivR2;
      s1[i] = pivS1;
      s2[i] = pivS2;
    }

    return [
      { name: 'pivot', values: pivot },
      { name: 'r1', values: r1 },
      { name: 'r2', values: r2 },
      { name: 's1', values: s1 },
      { name: 's2', values: s2 },
    ];
  }
}
