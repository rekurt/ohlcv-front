import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Relative Strength Index (Wilder's smoothing). Returns a single series
 * `rsi` with values in [0, 100]. Oversold < 30, overbought > 70 by tradition.
 *
 * Requires a dedicated sub-pane because RSI's [0, 100] range cannot share
 * the price pane's auto-scaled axis.
 *
 * Formula:
 *   - gain_i = max(close_i - close_{i-1}, 0)
 *   - loss_i = max(close_{i-1} - close_i, 0)
 *   - avgGain = Wilder EMA of gain (seeded with SMA of first `period`)
 *   - avgLoss = same for loss
 *   - RS = avgGain / avgLoss
 *   - RSI = 100 - 100 / (1 + RS)
 */
export class RSI extends Indicator {
  readonly placement: IndicatorPlacement = 'pane';

  constructor(public readonly period: number = 14) {
    super();
    if (!Number.isInteger(period) || period < 2) {
      throw new Error(`RSI period must be an integer >= 2, got ${period}`);
    }
  }

  get id(): string {
    return `rsi(${this.period})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const rsi = nanArray(n);
    if (n <= this.period) return [{ name: 'rsi', values: rsi }];

    // Seed: SMA of gains/losses over the first `period` price changes.
    let sumGain = 0;
    let sumLoss = 0;
    for (let i = 1; i <= this.period; i++) {
      const diff = buffer.candleAt(i)!.c - buffer.candleAt(i - 1)!.c;
      if (diff > 0) sumGain += diff;
      else sumLoss += -diff;
    }
    let avgGain = sumGain / this.period;
    let avgLoss = sumLoss / this.period;
    rsi[this.period] = rsiFromAvg(avgGain, avgLoss);

    // Wilder smoothing for the rest.
    for (let i = this.period + 1; i < n; i++) {
      const diff = buffer.candleAt(i)!.c - buffer.candleAt(i - 1)!.c;
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (this.period - 1) + gain) / this.period;
      avgLoss = (avgLoss * (this.period - 1) + loss) / this.period;
      rsi[i] = rsiFromAvg(avgGain, avgLoss);
    }

    return [{ name: 'rsi', values: rsi }];
  }
}

function rsiFromAvg(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
