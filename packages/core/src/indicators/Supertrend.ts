import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Supertrend (Olivier Seban) — an ATR-banded trend-follower that
 * flips between an upper and lower band as price crosses it.
 *
 *   basicUpper = hl2 + mult*ATR     basicLower = hl2 − mult*ATR
 *   finalUpper / finalLower carry forward unless price breaks them.
 *   supertrend = lower band in an uptrend, upper band in a downtrend.
 *
 * Emits two series:
 *   - `supertrend`: the active band (the line traders watch)
 *   - `direction`: +1 (uptrend) / −1 (downtrend), useful for coloring
 *
 * ATR uses Wilder smoothing, matching the standalone ATR indicator.
 * Placement is `'overlay'` (the supertrend line is a price level).
 */
export class Supertrend extends Indicator {
  readonly placement: IndicatorPlacement = 'overlay';

  constructor(
    public readonly period: number = 10,
    public readonly mult: number = 3,
  ) {
    super();
    if (!Number.isInteger(period) || period < 2) {
      throw new Error(`Supertrend period must be an integer >= 2, got ${period}`);
    }
    if (!Number.isFinite(mult) || mult <= 0) {
      throw new Error(`Supertrend mult must be a positive number, got ${mult}`);
    }
  }

  get id(): string {
    return `supertrend(${this.period},${this.mult})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const line = nanArray(n);
    const direction = nanArray(n);
    const p = this.period;
    if (n <= p) {
      return [
        { name: 'supertrend', values: line },
        { name: 'direction', values: direction },
      ];
    }

    // True range + Wilder ATR.
    const tr = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const cur = buffer.candleAt(i)!;
      const prev = buffer.candleAt(i - 1)!;
      tr[i] = Math.max(
        cur.h - cur.l,
        Math.abs(cur.h - prev.c),
        Math.abs(cur.l - prev.c),
      );
    }
    const atr = new Float64Array(n);
    atr.fill(NaN);
    let sum = 0;
    for (let i = 1; i <= p; i++) sum += tr[i]!;
    atr[p] = sum / p;
    for (let i = p + 1; i < n; i++) {
      atr[i] = (atr[i - 1]! * (p - 1) + tr[i]!) / p;
    }

    let finalUpper = NaN;
    let finalLower = NaN;
    let dir = 1; // start assuming uptrend; corrected on the first bar
    let prevClose = NaN;

    for (let i = p; i < n; i++) {
      const c = buffer.candleAt(i)!;
      const hl2 = (c.h + c.l) / 2;
      const a = atr[i]!;
      const basicUpper = hl2 + this.mult * a;
      const basicLower = hl2 - this.mult * a;

      if (i === p) {
        finalUpper = basicUpper;
        finalLower = basicLower;
        dir = c.c <= basicUpper ? -1 : 1;
      } else {
        // Carry-forward rules from Seban's definition.
        finalUpper =
          basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper;
        finalLower =
          basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower;

        // Flip direction on band breaks.
        if (dir === -1 && c.c > finalUpper) dir = 1;
        else if (dir === 1 && c.c < finalLower) dir = -1;
      }

      line[i] = dir === 1 ? finalLower : finalUpper;
      direction[i] = dir;
      prevClose = c.c;
    }

    return [
      { name: 'supertrend', values: line },
      { name: 'direction', values: direction },
    ];
  }
}
