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

    for (let i = this.period; i < n; i++) {
      const cur = buffer.candleAt(i)!.c;
      const past = buffer.candleAt(i - this.period)!.c;
      out[i] = past === 0 ? 0 : ((cur - past) / past) * 100;
    }

    return [{ name: 'roc', values: out }];
  }
}
