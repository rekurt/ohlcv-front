import type { Candle } from '@rekurt/openkline-core';
import type { SymbolInfo } from './symbols';
import type { ResolutionInfo } from './resolutions';

/** Mulberry32 — tiny, fast, deterministic PRNG (not crypto-safe, fine for demos). */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface GenerateCandlesOptions {
  symbol: SymbolInfo;
  resolution: ResolutionInfo;
  count: number;
  /** Unix seconds. Defaults to now. */
  endTime?: number;
}

/**
 * Deterministic random walk with mean reversion. Each (symbol, resolution)
 * pair produces a distinct but reproducible chart across reloads.
 */
export function generateCandles(opts: GenerateCandlesOptions): Candle[] {
  const { symbol, resolution, count } = opts;
  const endTime = opts.endTime ?? Math.floor(Date.now() / 1000);
  const lastBucket = endTime - (endTime % resolution.seconds);

  const rng = mulberry32(symbol.seed * 1_000_000 + resolution.seconds);
  const volatility = symbol.basePrice * 0.002;
  const candles: Candle[] = new Array(count);

  let price = symbol.basePrice;
  for (let i = 0; i < count; i++) {
    const meanRev = ((symbol.basePrice - price) / symbol.basePrice) * 0.5;
    const drift = (rng() - 0.5) * volatility * 2;
    const open = price;
    price = price + drift + meanRev;
    const close = price;
    const high = Math.max(open, close) + rng() * volatility * 0.8;
    const low = Math.min(open, close) - rng() * volatility * 0.8;

    // Volume with occasional 3–5x spikes
    let volume = 1000 + rng() * 500;
    if (rng() < 0.05) volume *= 3 + rng() * 2;

    // Write in reverse: i=0 is the NEWEST candle, then walk back in time
    candles[count - 1 - i] = {
      o: round2(open),
      h: round2(high),
      l: round2(low),
      c: round2(close),
      v: Math.round(volume),
      t: lastBucket - i * resolution.seconds,
    };
  }

  return candles;
}

export interface AdvanceOptions {
  lastCandle: Candle;
  symbol: SymbolInfo;
  tickIndex: number;
}

/**
 * Returns a new version of the last candle with a small random delta applied
 * to `close`, updating `high`/`low`/`volume`. Preserves `time` — same bucket.
 */
export function advanceLastCandle(opts: AdvanceOptions): Candle {
  const { lastCandle, symbol, tickIndex } = opts;
  const rng = mulberry32(symbol.seed * 7919 + tickIndex);
  const volatility = symbol.basePrice * 0.0005;
  const delta = (rng() - 0.5) * volatility * 2;
  const newClose = lastCandle.c + delta;
  return {
    o: lastCandle.o,
    h: round2(Math.max(lastCandle.h, newClose)),
    l: round2(Math.min(lastCandle.l, newClose)),
    c: round2(newClose),
    v: lastCandle.v + Math.round(rng() * 50),
    t: lastCandle.t,
  };
}
