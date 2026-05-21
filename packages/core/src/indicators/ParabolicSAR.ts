import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Parabolic SAR (Wilder 1978) — "stop and reverse" dots that trail
 * price and flip side when hit. Classic trailing-stop / trend tool.
 *
 * Parameters:
 *   step (AF increment, default 0.02)
 *   max  (AF cap, default 0.20)
 *
 * Algorithm (per Wilder):
 *   SAR_{t+1} = SAR_t + AF * (EP − SAR_t)
 *   where EP is the extreme point of the current trend and AF the
 *   acceleration factor, incremented by `step` (capped at `max`) each
 *   time a new EP is made. On a flip, SAR resets to the prior EP and
 *   AF resets to `step`.
 *
 * Single overlay series of SAR dots (rendered as a line by the
 * overlay renderer; consumers can style it as points).
 */
export class ParabolicSAR extends Indicator {
  readonly placement: IndicatorPlacement = 'overlay';

  constructor(
    public readonly step: number = 0.02,
    public readonly max: number = 0.2,
  ) {
    super();
    if (!Number.isFinite(step) || step <= 0) {
      throw new Error(`ParabolicSAR step must be a positive number, got ${step}`);
    }
    if (!Number.isFinite(max) || max < step) {
      throw new Error(`ParabolicSAR max must be >= step, got ${max}`);
    }
  }

  get id(): string {
    return `psar(${this.step},${this.max})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const sar = nanArray(n);
    if (n < 2) return [{ name: 'psar', values: sar }];

    const c0 = buffer.candleAt(0)!;
    const c1 = buffer.candleAt(1)!;
    // Seed trend by comparing the first two closes.
    let uptrend = c1.c >= c0.c;
    let af = this.step;
    let ep = uptrend ? Math.max(c0.h, c1.h) : Math.min(c0.l, c1.l);
    let sarVal = uptrend ? Math.min(c0.l, c1.l) : Math.max(c0.h, c1.h);
    sar[1] = sarVal;

    for (let i = 2; i < n; i++) {
      const c = buffer.candleAt(i)!;
      const prev = buffer.candleAt(i - 1)!;
      const prev2 = buffer.candleAt(i - 2)!;

      // Tentative next SAR.
      let next = sarVal + af * (ep - sarVal);

      if (uptrend) {
        // SAR can't be above the prior two lows.
        next = Math.min(next, prev.l, prev2.l);
        if (c.l < next) {
          // Flip to downtrend.
          uptrend = false;
          next = ep; // reset SAR to the prior EP
          ep = c.l;
          af = this.step;
        } else {
          if (c.h > ep) {
            ep = c.h;
            af = Math.min(this.max, af + this.step);
          }
        }
      } else {
        // SAR can't be below the prior two highs.
        next = Math.max(next, prev.h, prev2.h);
        if (c.h > next) {
          uptrend = true;
          next = ep;
          ep = c.h;
          af = this.step;
        } else {
          if (c.l < ep) {
            ep = c.l;
            af = Math.min(this.max, af + this.step);
          }
        }
      }

      sarVal = next;
      sar[i] = sarVal;
    }

    return [{ name: 'psar', values: sar }];
  }
}
