import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Volume Weighted Average Price.
 *
 *   typicalPrice_i = (high + low + close) / 3
 *   vwap_i = Σ(typicalPrice * volume) / Σ(volume)
 *
 * Default behavior is session-anchored: the cumulative sums reset at
 * the start of each UTC day (every 86400 s). Consumers can force
 * cumulative-from-start by setting `anchor: 'cumulative'`.
 *
 * Placement is `'overlay'` — VWAP is a price-equivalent line that
 * belongs on the main price pane.
 */
export type VWAPAnchor = 'session' | 'cumulative';

export class VWAP extends Indicator {
  readonly placement: IndicatorPlacement = 'overlay';

  constructor(public readonly anchor: VWAPAnchor = 'session') {
    super();
  }

  get id(): string {
    return `vwap(${this.anchor})`;
  }

  protected _compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const vwap = nanArray(n);
    if (n === 0) return [{ name: 'vwap', values: vwap }];

    const SESSION = 86_400;
    let currentDay = -1;
    let sumPV = 0;
    let sumV = 0;

    for (let i = 0; i < n; i++) {
      const candle = buffer.candleAt(i)!;
      if (this.anchor === 'session') {
        const day = Math.floor(candle.t / SESSION);
        if (day !== currentDay) {
          currentDay = day;
          sumPV = 0;
          sumV = 0;
        }
      }
      const typical = (candle.h + candle.l + candle.c) / 3;
      sumPV += typical * candle.v;
      sumV += candle.v;
      vwap[i] = sumV > 0 ? sumPV / sumV : NaN;
    }

    return [{ name: 'vwap', values: vwap }];
  }
}
