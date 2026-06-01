import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Volume Weighted Average Price.
 *
 *   typicalPrice_i = (high + low + close) / 3
 *   vwap_i = Σ(typicalPrice * volume) / Σ(volume)
 *
 * Anchor modes:
 * - `'session'` (default) — cumulative sums reset at the start of
 *   each UTC day (every 86400 s). Standard intraday VWAP.
 * - `'cumulative'` — cumulative-from-start (never resets).
 * - `{ type: 'anchored', t: <unix-seconds> }` — anchored VWAP.
 *   Values before `t` are NaN; from the first candle with time ≥ `t`
 *   the cumulative sums begin and never reset. Useful for measuring
 *   VWAP from a breakout, news event, or session open.
 *
 * Placement is `'overlay'` — VWAP is a price-equivalent line that
 * belongs on the main price pane.
 */
export type VWAPAnchor =
  | 'session'
  | 'cumulative'
  | { type: 'anchored'; t: number };

export class VWAP extends Indicator {
  readonly placement: IndicatorPlacement = 'overlay';

  constructor(public readonly anchor: VWAPAnchor = 'session') {
    super();
    if (
      typeof anchor === 'object' &&
      anchor !== null &&
      (typeof anchor.t !== 'number' || !Number.isFinite(anchor.t) || anchor.t <= 0)
    ) {
      throw new Error(
        `VWAP anchored.t must be a positive finite number, got ${String(anchor.t)}`,
      );
    }
  }

  get id(): string {
    if (typeof this.anchor === 'string') return `vwap(${this.anchor})`;
    return `vwap(anchored:${this.anchor.t})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const vwap = nanArray(n);
    if (n === 0) return [{ name: 'vwap', values: vwap }];

    const view = buffer.sliceView(0, n);
    const high = view.high;
    const low = view.low;
    const close = view.close;
    const volume = view.volume;
    const time = view.time;

    const SESSION = 86_400;
    let currentDay = -1;
    let sumPV = 0;
    let sumV = 0;
    const anchoredT =
      typeof this.anchor === 'object' && this.anchor !== null ? this.anchor.t : -Infinity;
    let anchorReached = anchoredT === -Infinity;

    for (let i = 0; i < n; i++) {
      if (this.anchor === 'session') {
        const day = Math.floor(time[i]! / SESSION);
        if (day !== currentDay) {
          currentDay = day;
          sumPV = 0;
          sumV = 0;
        }
      } else if (typeof this.anchor === 'object') {
        if (!anchorReached) {
          if (time[i]! >= anchoredT) {
            anchorReached = true;
            sumPV = 0;
            sumV = 0;
          } else {
            // Before the anchor — emit NaN and skip accumulation.
            continue;
          }
        }
      }
      const typical = (high[i]! + low[i]! + close[i]!) / 3;
      sumPV += typical * volume[i]!;
      sumV += volume[i]!;
      vwap[i] = sumV > 0 ? sumPV / sumV : NaN;
    }

    return [{ name: 'vwap', values: vwap }];
  }
}
