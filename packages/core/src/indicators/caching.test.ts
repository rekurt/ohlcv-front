import { describe, it, expect } from 'vitest';
import { SMA } from './SMA';
import { RSI } from './RSI';
import { Stochastic } from './Stochastic';
import { EMA } from './EMA';
import { CandleBuffer } from '../data/CandleBuffer';
import type { Candle } from '../types';

function makeCandle(i: number, c: number): Candle {
  return { o: c, h: c + 1, l: c - 1, c, v: 1, t: 1_700_000_000 + i * 60 };
}

function bufferOf(closes: number[]): CandleBuffer {
  const buf = new CandleBuffer();
  closes.forEach((c, i) => buf.append(makeCandle(i, c)));
  return buf;
}

describe('CandleBuffer.version', () => {
  it('starts at 0 and increments on append', () => {
    const buf = new CandleBuffer();
    expect(buf.version).toBe(0);
    buf.append(makeCandle(0, 100));
    expect(buf.version).toBe(1);
    buf.append(makeCandle(1, 101));
    expect(buf.version).toBe(2);
  });

  it('increments on updateLast, prepend, appendBatch, and clear', () => {
    const buf = bufferOf([100, 101, 102]);
    const v0 = buf.version;
    buf.updateLast(makeCandle(2, 103));
    expect(buf.version).toBe(v0 + 1);
    buf.appendBatch([makeCandle(3, 104), makeCandle(4, 105)]);
    expect(buf.version).toBe(v0 + 2);
    buf.prepend([makeCandle(-1, 99)]);
    expect(buf.version).toBe(v0 + 3);
    buf.clear();
    expect(buf.version).toBe(v0 + 4);
  });

  it('does not increment when appendBatch adds nothing', () => {
    const buf = bufferOf([100, 101]);
    const v = buf.version;
    // All candles predate lastTime → dropped, no mutation.
    buf.appendBatch([makeCandle(0, 50)]);
    expect(buf.version).toBe(v);
  });
});

describe('Indicator memoization', () => {
  it('returns the same array reference while the buffer is unchanged', () => {
    const buf = bufferOf([1, 2, 3, 4, 5, 6]);
    const sma = new SMA(3);
    const a = sma.compute(buf);
    const b = sma.compute(buf);
    expect(b).toBe(a);
    expect(b[0]).toBe(a[0]);
  });

  it('recomputes after the buffer mutates', () => {
    const buf = bufferOf([1, 2, 3, 4, 5, 6]);
    const sma = new SMA(3);
    const a = sma.compute(buf);
    buf.append(makeCandle(6, 7));
    const b = sma.compute(buf);
    expect(b).not.toBe(a);
    // New series is one element longer (aligned 1:1 with the buffer).
    expect(b[0]!.values.length).toBe(7);
  });

  it('cache is per-instance (two SMAs do not share)', () => {
    const buf = bufferOf([1, 2, 3, 4, 5]);
    const a = new SMA(3).compute(buf);
    const b = new SMA(3).compute(buf);
    expect(b).not.toBe(a);
    expect(Array.from(b[0]!.values)).toEqual(Array.from(a[0]!.values));
  });

  it('preserves numeric correctness through the cache wrapper', () => {
    const buf = bufferOf([10, 20, 30]);
    const ema = new EMA(2);
    const first = ema.compute(buf)[0]!.values;
    const second = ema.compute(buf)[0]!.values;
    expect(Array.from(second)).toEqual(Array.from(first));
  });
});

describe('Indicator pane metadata', () => {
  it('overlay indicators default to auto-scale (no fixed range)', () => {
    expect(new SMA(20).paneRange).toBeNull();
    expect(new SMA(20).referenceLines).toEqual([]);
  });

  it('RSI is fixed to [0, 100] with 30/70 reference lines', () => {
    const rsi = new RSI(14);
    expect(rsi.paneRange).toEqual({ min: 0, max: 100 });
    expect(rsi.referenceLines).toEqual([30, 70]);
  });

  it('Stochastic is fixed to [0, 100] with 20/80 reference lines', () => {
    const stoch = new Stochastic();
    expect(stoch.paneRange).toEqual({ min: 0, max: 100 });
    expect(stoch.referenceLines).toEqual([20, 80]);
  });
});
