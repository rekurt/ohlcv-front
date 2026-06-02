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

    const view = buffer.sliceView(0, n);
    const close = view.close;
    const volume = view.volume;

    out[0] = 0;
    let cum = 0;
    let prev = close[0]!;
    for (let i = 1; i < n; i++) {
      const cc = close[i]!;
      if (cc > prev) cum += volume[i]!;
      else if (cc < prev) cum -= volume[i]!;
      out[i] = cum;
      prev = cc;
    }

    return [{ name: 'obv', values: out }];
  }

  /**
   * Incremental tail patch. OBV is cumulative:
   *   out[i] = out[i-1] ± volume[i]   (sign from close[i] vs close[i-1])
   * The running tally up to index `i-1` is exactly `prev[i-1]`, and
   * out[i-1] itself never changes under an `updateLast` (it depends only
   * on candles ≤ i-1, none of which moved) nor under an `append`. So the
   * single touched index is recomputed from `prev[i-1]` plus the current
   * close[i]/close[i-1]/volume[i]. Index 0 is the cumulative origin (0).
   */
  protected override updateTail(
    buffer: CandleBuffer,
    prev: IndicatorSeries[],
    kind: 'append' | 'updateLast',
  ): IndicatorSeries[] | null {
    const n = buffer.length;
    const i = n - 1;

    const prevValues = prev[0]!.values;
    const out = new Float64Array(n);
    out.set(kind === 'append' ? prevValues : prevValues.subarray(0, i));

    if (i === 0) {
      out[0] = 0;
      return [{ name: 'obv', values: out }];
    }

    const view = buffer.sliceView(0, n);
    const close = view.close;
    const volume = view.volume;
    const base = out[i - 1]!;
    const cc = close[i]!;
    const pc = close[i - 1]!;
    out[i] = cc > pc ? base + volume[i]! : cc < pc ? base - volume[i]! : base;

    return [{ name: 'obv', values: out }];
  }
}
