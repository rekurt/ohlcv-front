import type { Candle } from '../types';

/**
 * Heikin Ashi transforms raw OHLC candles into a smoothed variant that
 * filters out market noise. The transform is purely local — each HA
 * candle depends only on the current raw candle and the previous HA
 * candle — so it can be streamed incrementally.
 *
 * Formulas:
 *   HA.close  = (o + h + l + c) / 4
 *   HA.open   = (prev HA.open + prev HA.close) / 2          (first: (o + c) / 2)
 *   HA.high   = max(raw.high, HA.open, HA.close)
 *   HA.low    = min(raw.low,  HA.open, HA.close)
 *
 * The timestamps and volumes are copied verbatim from the raw input.
 *
 * Usage pattern: transform your full candle array, then feed the
 * result into `OHLCVChart.setData()`. For live updates, call
 * `advanceHeikinAshi(prevHA, rawCandle)` with the latest raw candle.
 */
export function toHeikinAshi(candles: readonly Candle[]): Candle[] {
  const out: Candle[] = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const raw = candles[i]!;
    if (i === 0) {
      const haClose = (raw.o + raw.h + raw.l + raw.c) / 4;
      const haOpen = (raw.o + raw.c) / 2;
      out[i] = {
        o: haOpen,
        c: haClose,
        h: Math.max(raw.h, haOpen, haClose),
        l: Math.min(raw.l, haOpen, haClose),
        v: raw.v,
        t: raw.t,
      };
      continue;
    }
    const prev = out[i - 1]!;
    const haClose = (raw.o + raw.h + raw.l + raw.c) / 4;
    const haOpen = (prev.o + prev.c) / 2;
    out[i] = {
      o: haOpen,
      c: haClose,
      h: Math.max(raw.h, haOpen, haClose),
      l: Math.min(raw.l, haOpen, haClose),
      v: raw.v,
      t: raw.t,
    };
  }
  return out;
}

/**
 * Compute the next Heikin Ashi candle given the previous HA candle and
 * the latest raw candle. Use for live-tick updates without recomputing
 * the whole series.
 */
export function advanceHeikinAshi(previousHA: Candle | null, rawCandle: Candle): Candle {
  const haClose = (rawCandle.o + rawCandle.h + rawCandle.l + rawCandle.c) / 4;
  const haOpen =
    previousHA === null
      ? (rawCandle.o + rawCandle.c) / 2
      : (previousHA.o + previousHA.c) / 2;
  return {
    o: haOpen,
    c: haClose,
    h: Math.max(rawCandle.h, haOpen, haClose),
    l: Math.min(rawCandle.l, haOpen, haClose),
    v: rawCandle.v,
    t: rawCandle.t,
  };
}
