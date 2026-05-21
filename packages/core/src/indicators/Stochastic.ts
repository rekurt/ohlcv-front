import { Indicator, type IndicatorPlacement, type IndicatorSeries, type PaneRange, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Stochastic oscillator:
 *
 *   %K = 100 * (close − lowestLow(kPeriod)) / (highestHigh(kPeriod) − lowestLow(kPeriod))
 *   %D = SMA(%K, dPeriod)
 *
 * Classic parameters are (14, 3): 14-bar lookback for %K, 3-bar SMA
 * for %D (the signal line). Both outputs live in [0, 100]; readings
 * above 80 are conventionally considered overbought, below 20 oversold.
 *
 * Placement is `'pane'` because the [0, 100] range doesn't share the
 * price axis.
 */
export class Stochastic extends Indicator {
  readonly placement: IndicatorPlacement = 'pane';

  constructor(
    public readonly kPeriod: number = 14,
    public readonly dPeriod: number = 3,
  ) {
    super();
    if (!Number.isInteger(kPeriod) || kPeriod < 1) {
      throw new Error(`Stochastic kPeriod must be a positive integer, got ${kPeriod}`);
    }
    if (!Number.isInteger(dPeriod) || dPeriod < 1) {
      throw new Error(`Stochastic dPeriod must be a positive integer, got ${dPeriod}`);
    }
  }

  get id(): string {
    return `stoch(${this.kPeriod},${this.dPeriod})`;
  }

  override get paneRange(): PaneRange {
    return { min: 0, max: 100 };
  }

  override get referenceLines(): number[] {
    return [20, 80];
  }

  protected _compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const k = nanArray(n);
    const d = nanArray(n);
    if (n < this.kPeriod) return [{ name: 'k', values: k }, { name: 'd', values: d }];

    for (let i = this.kPeriod - 1; i < n; i++) {
      let hh = -Infinity;
      let ll = Infinity;
      for (let j = i - this.kPeriod + 1; j <= i; j++) {
        const candle = buffer.candleAt(j)!;
        if (candle.h > hh) hh = candle.h;
        if (candle.l < ll) ll = candle.l;
      }
      const close = buffer.candleAt(i)!.c;
      const range = hh - ll;
      k[i] = range === 0 ? 100 : ((close - ll) / range) * 100;
    }

    // %D is an SMA of %K.
    for (let i = this.kPeriod - 1 + this.dPeriod - 1; i < n; i++) {
      let sum = 0;
      for (let j = i - this.dPeriod + 1; j <= i; j++) sum += k[j]!;
      d[i] = sum / this.dPeriod;
    }

    return [
      { name: 'k', values: k },
      { name: 'd', values: d },
    ];
  }
}
