import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Ichimoku Kinkō Hyō ("one-glance equilibrium chart"). The full
 * five-line setup, all rendered as overlays on the main price pane:
 *
 *   Tenkan-sen   (conversion line) = (highest(tenkan) + lowest(tenkan)) / 2
 *   Kijun-sen    (base line)       = (highest(kijun)  + lowest(kijun))  / 2
 *   Senkou A     (leading span A)  = (Tenkan + Kijun) / 2, shifted +displacement
 *   Senkou B     (leading span B)  = (highest(senkouB) + lowest(senkouB)) / 2, shifted +displacement
 *   Chikou-sen   (lagging span)    = current close, shifted −displacement
 *
 * The kumo (cloud) is the band between Senkou A and Senkou B; we
 * emit both as separate series and let the renderer decide whether
 * to fill the gap.
 *
 * Standard parameters (Hosoda 1969): 9 / 26 / 52, displacement 26.
 *
 * Window highs/lows are computed via monotonic-deque so each window
 * slide is amortized O(1) — important because Ichimoku has THREE
 * different window sizes evaluated in parallel.
 */
export class Ichimoku extends Indicator {
  readonly placement: IndicatorPlacement = 'overlay';

  constructor(
    public readonly tenkanPeriod: number = 9,
    public readonly kijunPeriod: number = 26,
    public readonly senkouBPeriod: number = 52,
    public readonly displacement: number = 26,
  ) {
    super();
    const check = (n: number, name: string) => {
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`Ichimoku ${name} must be a positive integer, got ${n}`);
      }
    };
    check(tenkanPeriod, 'tenkanPeriod');
    check(kijunPeriod, 'kijunPeriod');
    check(senkouBPeriod, 'senkouBPeriod');
    check(displacement, 'displacement');
  }

  get id(): string {
    return `ichimoku(${this.tenkanPeriod},${this.kijunPeriod},${this.senkouBPeriod},${this.displacement})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const tenkan = nanArray(n);
    const kijun = nanArray(n);
    const senkouA = nanArray(n);
    const senkouB = nanArray(n);
    const chikou = nanArray(n);

    if (n === 0) {
      return [
        { name: 'tenkan', values: tenkan },
        { name: 'kijun', values: kijun },
        { name: 'senkouA', values: senkouA },
        { name: 'senkouB', values: senkouB },
        { name: 'chikou', values: chikou },
      ];
    }

    // Pre-pull h/l once into typed arrays for monotonic-deque math.
    const view = buffer.sliceView(0, n);
    const high = new Float64Array(n);
    const low = new Float64Array(n);
    const close = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      high[i] = view.high[i]!;
      low[i] = view.low[i]!;
      close[i] = view.close[i]!;
    }

    const midpoint = (
      target: Float64Array,
      period: number,
    ): void => {
      const hi: number[] = [];
      const lo: number[] = [];
      for (let i = 0; i < n; i++) {
        while (hi.length > 0 && high[hi[hi.length - 1]!]! <= high[i]!) hi.pop();
        hi.push(i);
        while (lo.length > 0 && low[lo[lo.length - 1]!]! >= low[i]!) lo.pop();
        lo.push(i);
        while (hi.length > 0 && hi[0]! <= i - period) hi.shift();
        while (lo.length > 0 && lo[0]! <= i - period) lo.shift();
        if (i >= period - 1) {
          target[i] = (high[hi[0]!]! + low[lo[0]!]!) / 2;
        }
      }
    };

    midpoint(tenkan, this.tenkanPeriod);
    midpoint(kijun, this.kijunPeriod);
    const senkouBRaw = nanArray(n);
    midpoint(senkouBRaw, this.senkouBPeriod);

    // Senkou A = (Tenkan + Kijun) / 2, shifted forward by `displacement`.
    // Senkou B is `senkouBRaw` shifted forward by `displacement`.
    // Forward-shifted values that land past the buffer end are dropped
    // (a future renderer extension would project the cloud into the
    // empty right-side zone; we don't try here).
    for (let i = 0; i < n; i++) {
      const dst = i + this.displacement;
      if (dst < n) {
        if (Number.isFinite(tenkan[i]) && Number.isFinite(kijun[i])) {
          senkouA[dst] = (tenkan[i]! + kijun[i]!) / 2;
        }
        if (Number.isFinite(senkouBRaw[i])) {
          senkouB[dst] = senkouBRaw[i]!;
        }
      }
    }

    // Chikou: current close shifted BACK by displacement. Indices
    // before displacement are NaN (no past slot to write into).
    for (let i = this.displacement; i < n; i++) {
      chikou[i - this.displacement] = close[i]!;
    }

    return [
      { name: 'tenkan', values: tenkan },
      { name: 'kijun', values: kijun },
      { name: 'senkouA', values: senkouA },
      { name: 'senkouB', values: senkouB },
      { name: 'chikou', values: chikou },
    ];
  }
}
