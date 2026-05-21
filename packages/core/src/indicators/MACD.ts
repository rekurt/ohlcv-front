import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Moving Average Convergence Divergence.
 *
 *   macd      = EMA(close, fast) − EMA(close, slow)
 *   signal    = EMA(macd, signalPeriod)
 *   histogram = macd − signal
 *
 * Three aligned series. `placement: 'pane'` because the histogram
 * oscillates around zero and doesn't belong on the main price axis.
 *
 * Default parameters match TradingView: (12, 26, 9).
 */
export class MACD extends Indicator {
  readonly placement: IndicatorPlacement = 'pane';

  constructor(
    public readonly fastPeriod: number = 12,
    public readonly slowPeriod: number = 26,
    public readonly signalPeriod: number = 9,
  ) {
    super();
    if (
      !Number.isInteger(fastPeriod) ||
      !Number.isInteger(slowPeriod) ||
      !Number.isInteger(signalPeriod)
    ) {
      throw new Error('MACD periods must be integers');
    }
    if (fastPeriod < 2 || slowPeriod < 2 || signalPeriod < 2) {
      throw new Error('MACD periods must be >= 2');
    }
    if (fastPeriod >= slowPeriod) {
      throw new Error(`MACD fastPeriod (${fastPeriod}) must be < slowPeriod (${slowPeriod})`);
    }
  }

  get id(): string {
    return `macd(${this.fastPeriod},${this.slowPeriod},${this.signalPeriod})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const macd = nanArray(n);
    const signal = nanArray(n);
    const histogram = nanArray(n);

    if (n < this.slowPeriod) {
      return [
        { name: 'macd', values: macd },
        { name: 'signal', values: signal },
        { name: 'histogram', values: histogram },
      ];
    }

    // Compute close array once — EMAs iterate over it several times.
    const closes = new Float64Array(n);
    for (let i = 0; i < n; i++) closes[i] = buffer.candleAt(i)!.c;

    const fast = ema(closes, this.fastPeriod);
    const slow = ema(closes, this.slowPeriod);

    // macd aligned: first valid index is slowPeriod - 1
    for (let i = this.slowPeriod - 1; i < n; i++) {
      macd[i] = fast[i]! - slow[i]!;
    }

    // signal = EMA of macd starting at slowPeriod - 1.
    // We feed only the valid macd tail to ema().
    const validStart = this.slowPeriod - 1;
    const macdTail = macd.subarray(validStart);
    const signalTail = ema(macdTail, this.signalPeriod);
    for (let i = 0; i < signalTail.length; i++) {
      const idx = validStart + i;
      signal[idx] = signalTail[i]!;
      if (!Number.isNaN(signal[idx]!) && !Number.isNaN(macd[idx]!)) {
        histogram[idx] = macd[idx]! - signal[idx]!;
      }
    }

    return [
      { name: 'macd', values: macd },
      { name: 'signal', values: signal },
      { name: 'histogram', values: histogram },
    ];
  }
}

/**
 * Standalone EMA over a Float64Array of values. Seeds at index
 * `period-1` with the SMA of the first `period` values, then applies
 * the standard recurrence `ema[i] = v[i]*k + ema[i-1]*(1-k)` where
 * `k = 2/(period+1)`. Positions before the seed are NaN.
 */
function ema(values: Float64Array, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  out.fill(NaN);
  if (n < period) return out;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  out[period - 1] = prev;

  const k = 2 / (period + 1);
  for (let i = period; i < n; i++) {
    const next = values[i]! * k + prev * (1 - k);
    out[i] = next;
    prev = next;
  }
  return out;
}
