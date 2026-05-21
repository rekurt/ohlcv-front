import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Hull Moving Average (Hull 2005) — a near-zero-lag moving average:
 *
 *   HMA = WMA( 2*WMA(period/2) − WMA(period), sqrt(period) )
 *
 * The double-WMA difference removes lag; the final sqrt-period WMA
 * re-smooths. Renders as a single overlay line.
 *
 * Implemented over a `close` array using the same rolling-WMA
 * recurrence as the WMA indicator, applied three times.
 */
export class HMA extends Indicator {
  readonly placement: IndicatorPlacement = 'overlay';

  constructor(public readonly period: number = 16) {
    super();
    if (!Number.isInteger(period) || period < 2) {
      throw new Error(`HMA period must be an integer >= 2, got ${period}`);
    }
  }

  get id(): string {
    return `hma(${this.period})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const out = nanArray(n);
    const p = this.period;
    if (n === 0 || n < p) return [{ name: 'hma', values: out }];

    const closes = new Float64Array(n);
    for (let i = 0; i < n; i++) closes[i] = buffer.candleAt(i)!.c;

    const half = Math.max(1, Math.floor(p / 2));
    const sqrtP = Math.max(1, Math.round(Math.sqrt(p)));

    const wmaHalf = rollingWMA(closes, half);
    const wmaFull = rollingWMA(closes, p);

    // raw = 2*WMA(half) − WMA(full); NaN where either is NaN.
    const raw = new Float64Array(n);
    raw.fill(NaN);
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(wmaHalf[i]) && Number.isFinite(wmaFull[i])) {
        raw[i] = 2 * wmaHalf[i]! - wmaFull[i]!;
      }
    }

    const hma = rollingWMAWithNaN(raw, sqrtP);
    for (let i = 0; i < n; i++) out[i] = hma[i]!;

    return [{ name: 'hma', values: out }];
  }
}

/** Rolling WMA over a dense Float64Array (no NaN gaps). */
function rollingWMA(values: Float64Array, p: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  out.fill(NaN);
  if (n < p) return out;
  const divisor = (p * (p + 1)) / 2;
  let sum = 0;
  let numerator = 0;
  for (let i = 0; i < p; i++) {
    const c = values[i]!;
    sum += c;
    numerator += c * (i + 1);
  }
  out[p - 1] = numerator / divisor;
  for (let i = p; i < n; i++) {
    const incoming = values[i]!;
    const outgoing = values[i - p]!;
    numerator = numerator + p * incoming - sum;
    sum = sum + incoming - outgoing;
    out[i] = numerator / divisor;
  }
  return out;
}

/**
 * Rolling WMA that tolerates a NaN warmup prefix in the input. Once
 * the window is fully populated with finite values it produces output;
 * any NaN inside the window yields NaN for that position (recomputed
 * directly rather than via the recurrence to stay correct across the
 * NaN boundary).
 */
function rollingWMAWithNaN(values: Float64Array, p: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  out.fill(NaN);
  const divisor = (p * (p + 1)) / 2;
  for (let i = p - 1; i < n; i++) {
    let numerator = 0;
    let ok = true;
    for (let k = 0; k < p; k++) {
      const v = values[i - p + 1 + k]!;
      if (!Number.isFinite(v)) {
        ok = false;
        break;
      }
      numerator += v * (k + 1);
    }
    if (ok) out[i] = numerator / divisor;
  }
  return out;
}
