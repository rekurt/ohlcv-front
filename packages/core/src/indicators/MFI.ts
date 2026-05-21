import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Money Flow Index (Quong & Soudack 1989) — the volume-weighted
 * cousin of RSI. Range `[0, 100]`; >80 is conventionally overbought,
 * <20 oversold.
 *
 *   typicalPrice_i = (h + l + c) / 3
 *   rawMoneyFlow_i = typicalPrice_i * v_i
 *   positiveFlow   = Σ rawMoneyFlow_i  where typical > prev typical
 *   negativeFlow   = Σ rawMoneyFlow_i  where typical < prev typical
 *   moneyRatio     = positiveFlow / negativeFlow
 *   MFI            = 100 − 100 / (1 + moneyRatio)
 *
 * Rolling implementation: maintain `positiveFlow` and `negativeFlow`
 * as sliding sums over `period` bars. Each step costs O(1).
 */
export class MFI extends Indicator {
  readonly placement: IndicatorPlacement = 'pane';

  constructor(public readonly period: number = 14) {
    super();
    if (!Number.isInteger(period) || period < 2) {
      throw new Error(`MFI period must be an integer >= 2, got ${period}`);
    }
  }

  get id(): string {
    return `mfi(${this.period})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const out = nanArray(n);
    if (n === 0 || n < this.period + 1) return [{ name: 'mfi', values: out }];

    const p = this.period;
    const typical = new Float64Array(n);
    const pflow = new Float64Array(n);
    const nflow = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const c = buffer.candleAt(i)!;
      typical[i] = (c.h + c.l + c.c) / 3;
      if (i === 0) continue;
      const tp = typical[i]!;
      const prev = typical[i - 1]!;
      const rmf = tp * c.v;
      if (tp > prev) pflow[i] = rmf;
      else if (tp < prev) nflow[i] = rmf;
      // Equal typical → contributes to neither side (Wilder convention).
    }

    // First window: sum positive/negative flow over indices [1..p].
    let posSum = 0;
    let negSum = 0;
    for (let i = 1; i <= p; i++) {
      posSum += pflow[i]!;
      negSum += nflow[i]!;
    }
    out[p] = negSum === 0 ? 100 : 100 - 100 / (1 + posSum / negSum);

    for (let i = p + 1; i < n; i++) {
      posSum += pflow[i]! - pflow[i - p]!;
      negSum += nflow[i]! - nflow[i - p]!;
      out[i] = negSum === 0 ? 100 : 100 - 100 / (1 + posSum / negSum);
    }

    return [{ name: 'mfi', values: out }];
  }
}
