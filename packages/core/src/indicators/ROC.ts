import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Rate of Change — percentage change of close vs. the close `period`
 * bars ago:
 *
 *   ROC = (close − close[t−period]) / close[t−period] * 100
 *
 * A pure momentum oscillator centered on zero. Sub-pane placement.
 */
export class ROC extends Indicator {
  readonly placement: IndicatorPlacement = 'pane';

  constructor(public readonly period: number = 12) {
    super();
    if (!Number.isInteger(period) || period < 1) {
      throw new Error(`ROC period must be a positive integer, got ${period}`);
    }
  }

  get id(): string {
    return `roc(${this.period})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const out = nanArray(n);
    if (n <= this.period) return [{ name: 'roc', values: out }];

    const view = buffer.sliceView(0, n);
    const close = view.close;

    for (let i = this.period; i < n; i++) {
      const cur = close[i]!;
      const past = close[i - this.period]!;
      out[i] = past === 0 ? 0 : ((cur - past) / past) * 100;
    }

    return [{ name: 'roc', values: out }];
  }

  /**
   * Incremental tail patch. ROC at index `i` depends only on `close[i]`
   * and `close[i-period]`, both still in the buffer — no prior output.
   * Recompute the single touched index. Warmup region is `i < period`
   * (the full compute starts the loop at `i === period`), where the value
   * stays NaN.
   */
  protected override updateTail(
    buffer: CandleBuffer,
    prev: IndicatorSeries[],
    kind: 'append' | 'updateLast',
  ): IndicatorSeries[] | null {
    const n = buffer.length;
    const i = n - 1;
    const p = this.period;

    const prevValues = prev[0]!.values;
    const out = new Float64Array(n);
    out.set(kind === 'append' ? prevValues : prevValues.subarray(0, i));

    if (i < p) {
      out[i] = NaN;
      return [{ name: 'roc', values: out }];
    }

    const close = buffer.sliceView(0, n).close;
    const cur = close[i]!;
    const past = close[i - p]!;
    out[i] = past === 0 ? 0 : ((cur - past) / past) * 100;

    return [{ name: 'roc', values: out }];
  }
}
