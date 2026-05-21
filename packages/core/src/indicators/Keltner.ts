import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Keltner Channels — an EMA midline with bands offset by a multiple
 * of the Average True Range:
 *
 *   middle = EMA(close, period)
 *   upper  = middle + mult * ATR(atrPeriod)
 *   lower  = middle − mult * ATR(atrPeriod)
 *
 * ATR uses Wilder smoothing (seeded with the SMA of the first
 * `atrPeriod` true ranges), matching the standalone ATR indicator.
 * Three overlay series: upper, middle, lower.
 */
export class Keltner extends Indicator {
  readonly placement: IndicatorPlacement = 'overlay';

  constructor(
    public readonly period: number = 20,
    public readonly mult: number = 2,
    public readonly atrPeriod: number = 10,
  ) {
    super();
    if (!Number.isInteger(period) || period < 1) {
      throw new Error(`Keltner period must be a positive integer, got ${period}`);
    }
    if (!Number.isInteger(atrPeriod) || atrPeriod < 1) {
      throw new Error(`Keltner atrPeriod must be a positive integer, got ${atrPeriod}`);
    }
    if (!Number.isFinite(mult) || mult <= 0) {
      throw new Error(`Keltner mult must be a positive number, got ${mult}`);
    }
  }

  get id(): string {
    return `keltner(${this.period},${this.mult},${this.atrPeriod})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const upper = nanArray(n);
    const middle = nanArray(n);
    const lower = nanArray(n);
    if (n === 0) {
      return [
        { name: 'upper', values: upper },
        { name: 'middle', values: middle },
        { name: 'lower', values: lower },
      ];
    }

    // EMA(close, period).
    const k = 2 / (this.period + 1);
    let ema = NaN;
    // ATR(atrPeriod) with Wilder smoothing.
    const ap = this.atrPeriod;
    let trSum = 0;
    let atr = NaN;
    let prevClose = NaN;

    for (let i = 0; i < n; i++) {
      const c = buffer.candleAt(i)!;
      // EMA seed = first close, then standard recurrence.
      ema = i === 0 ? c.c : c.c * k + ema * (1 - k);

      // True range.
      const tr =
        i === 0
          ? c.h - c.l
          : Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(prevClose - c.l));
      prevClose = c.c;

      if (i < ap) {
        trSum += tr;
        if (i === ap - 1) atr = trSum / ap;
      } else {
        atr = (atr * (ap - 1) + tr) / ap;
      }

      // Emit once both the EMA midline and ATR are warm. EMA is defined
      // from i=0 but is only meaningful after `period` bars; we gate on
      // max(period, atrPeriod) − 1 to match conventional warmup.
      const warm = Math.max(this.period, ap) - 1;
      if (i >= warm && Number.isFinite(atr)) {
        middle[i] = ema;
        upper[i] = ema + this.mult * atr;
        lower[i] = ema - this.mult * atr;
      }
    }

    return [
      { name: 'upper', values: upper },
      { name: 'middle', values: middle },
      { name: 'lower', values: lower },
    ];
  }
}
