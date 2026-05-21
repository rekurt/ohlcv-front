import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * On-Balance Volume (Granville 1963) — cumulative volume tally that
 * adds today's volume on up-closes and subtracts it on down-closes:
 *
 *   OBV[0] = 0
 *   OBV[i] =
 *     OBV[i-1] + v[i]     if c[i] > c[i-1]
 *     OBV[i-1] - v[i]     if c[i] < c[i-1]
 *     OBV[i-1]            otherwise
 *
 * Single series in its own pane. The absolute value is rarely
 * meaningful — what matters is the direction relative to price.
 */
export class OBV extends Indicator {
  readonly placement: IndicatorPlacement = 'pane';

  get id(): string {
    return 'obv';
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const out = nanArray(n);
    if (n === 0) return [{ name: 'obv', values: out }];

    out[0] = 0;
    let cum = 0;
    let prev = buffer.candleAt(0)!.c;
    for (let i = 1; i < n; i++) {
      const c = buffer.candleAt(i)!;
      if (c.c > prev) cum += c.v;
      else if (c.c < prev) cum -= c.v;
      out[i] = cum;
      prev = c.c;
    }

    return [{ name: 'obv', values: out }];
  }
}
