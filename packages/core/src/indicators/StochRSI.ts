import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Stochastic RSI (Chande & Kroll) — applies the stochastic oscillator
 * formula to RSI values instead of price, producing a more sensitive
 * overbought/oversold signal in `[0, 100]`.
 *
 *   RSI    = Wilder RSI(rsiPeriod)
 *   StochR = (RSI − lowestRSI(stochPeriod)) / (highestRSI − lowestRSI) * 100
 *   %K     = SMA(StochR, kSmooth)
 *   %D     = SMA(%K, dSmooth)
 *
 * Emits %K and %D in a sub-pane.
 */
export class StochRSI extends Indicator {
  readonly placement: IndicatorPlacement = 'pane';

  constructor(
    public readonly rsiPeriod: number = 14,
    public readonly stochPeriod: number = 14,
    public readonly kSmooth: number = 3,
    public readonly dSmooth: number = 3,
  ) {
    super();
    const check = (v: number, name: string) => {
      if (!Number.isInteger(v) || v < 1) {
        throw new Error(`StochRSI ${name} must be a positive integer, got ${v}`);
      }
    };
    check(rsiPeriod, 'rsiPeriod');
    check(stochPeriod, 'stochPeriod');
    check(kSmooth, 'kSmooth');
    check(dSmooth, 'dSmooth');
  }

  get id(): string {
    return `stochrsi(${this.rsiPeriod},${this.stochPeriod},${this.kSmooth},${this.dSmooth})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const kOut = nanArray(n);
    const dOut = nanArray(n);
    if (n <= this.rsiPeriod) {
      return [
        { name: 'k', values: kOut },
        { name: 'd', values: dOut },
      ];
    }

    // 1. Wilder RSI.
    const rsi = new Float64Array(n);
    rsi.fill(NaN);
    let gainSum = 0;
    let lossSum = 0;
    for (let i = 1; i <= this.rsiPeriod; i++) {
      const diff = buffer.candleAt(i)!.c - buffer.candleAt(i - 1)!.c;
      if (diff >= 0) gainSum += diff;
      else lossSum -= diff;
    }
    let avgGain = gainSum / this.rsiPeriod;
    let avgLoss = lossSum / this.rsiPeriod;
    rsi[this.rsiPeriod] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = this.rsiPeriod + 1; i < n; i++) {
      const diff = buffer.candleAt(i)!.c - buffer.candleAt(i - 1)!.c;
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (this.rsiPeriod - 1) + gain) / this.rsiPeriod;
      avgLoss = (avgLoss * (this.rsiPeriod - 1) + loss) / this.rsiPeriod;
      rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }

    // 2. Stochastic of RSI over stochPeriod.
    const stoch = new Float64Array(n);
    stoch.fill(NaN);
    const firstRsi = this.rsiPeriod;
    for (let i = firstRsi + this.stochPeriod - 1; i < n; i++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = i - this.stochPeriod + 1; j <= i; j++) {
        const r = rsi[j]!;
        if (r < lo) lo = r;
        if (r > hi) hi = r;
      }
      const range = hi - lo;
      stoch[i] = range === 0 ? 0 : ((rsi[i]! - lo) / range) * 100;
    }

    // 3. %K = SMA(stoch, kSmooth), %D = SMA(%K, dSmooth).
    smaInto(stoch, kOut, this.kSmooth);
    smaInto(kOut, dOut, this.dSmooth);

    return [
      { name: 'k', values: kOut },
      { name: 'd', values: dOut },
    ];
  }
}

/** SMA of a NaN-prefixed source into `dst`, window `p`. */
function smaInto(src: Float64Array, dst: Float64Array, p: number): void {
  const n = src.length;
  for (let i = 0; i < n; i++) {
    if (i < p - 1) continue;
    let sum = 0;
    let ok = true;
    for (let k = 0; k < p; k++) {
      const v = src[i - k]!;
      if (!Number.isFinite(v)) {
        ok = false;
        break;
      }
      sum += v;
    }
    if (ok) dst[i] = sum / p;
  }
}
