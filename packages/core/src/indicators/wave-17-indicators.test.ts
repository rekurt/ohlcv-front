import { describe, it, expect } from 'vitest';
import { WMA } from './WMA';
import { HMA } from './HMA';
import { Donchian } from './Donchian';
import { Keltner } from './Keltner';
import { SMA } from './SMA';
import { CandleBuffer } from '../data/CandleBuffer';
import type { Candle } from '../types';

function ohlcv(t: number, o: number, h: number, l: number, c: number, v = 1): Candle {
  return { o, h, l, c, v, t };
}

function closes(values: number[]): CandleBuffer {
  const buf = new CandleBuffer();
  values.forEach((c, i) => buf.append(ohlcv(i + 1, c, c, c, c)));
  return buf;
}

describe('WMA', () => {
  it('throws on invalid period', () => {
    expect(() => new WMA(0)).toThrow();
    expect(() => new WMA(1.5)).toThrow();
  });

  it('id and placement', () => {
    expect(new WMA(9).id).toBe('wma(9)');
    expect(new WMA(9).placement).toBe('overlay');
  });

  it('matches the textbook weighted formula', () => {
    // period 3, closes [1,2,3]: WMA = (1*1 + 2*2 + 3*3) / (1+2+3) = 14/6.
    const buf = closes([1, 2, 3]);
    const [s] = new WMA(3).compute(buf);
    expect(s!.values[2]).toBeCloseTo(14 / 6, 9);
  });

  it('rolling recurrence matches a direct recompute on a longer series', () => {
    const data = [5, 7, 6, 9, 11, 8, 10, 13, 12, 15];
    const buf = closes(data);
    const p = 4;
    const [s] = new WMA(p).compute(buf);
    // Direct WMA at the last index.
    const divisor = (p * (p + 1)) / 2;
    let num = 0;
    for (let k = 0; k < p; k++) num += data[data.length - p + k]! * (k + 1);
    expect(s!.values[data.length - 1]).toBeCloseTo(num / divisor, 9);
  });

  it('warmup NaN before period', () => {
    const [s] = new WMA(5).compute(closes([1, 2, 3]));
    expect(s!.values.every((v) => Number.isNaN(v))).toBe(true);
  });
});

describe('HMA', () => {
  it('throws on invalid period', () => {
    expect(() => new HMA(0)).toThrow();
    expect(() => new HMA(1)).toThrow();
  });

  it('id and placement', () => {
    expect(new HMA(16).id).toBe('hma(16)');
    expect(new HMA(16).placement).toBe('overlay');
  });

  it('tracks a strong linear trend closely (low lag)', () => {
    // On a pure linear ramp, HMA should sit very close to the latest
    // price (near-zero lag is the whole point).
    const data = Array.from({ length: 40 }, (_, i) => 100 + i);
    const buf = closes(data);
    const [s] = new HMA(9).compute(buf);
    const last = s!.values[39]!;
    expect(Number.isFinite(last)).toBe(true);
    expect(Math.abs(last - 139)).toBeLessThan(1.5);
  });

  it('produces finite values after warmup', () => {
    const data = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i));
    const [s] = new HMA(9).compute(closes(data));
    expect(s!.values.slice(-5).every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('Donchian', () => {
  it('throws on invalid period', () => {
    expect(() => new Donchian(0)).toThrow();
  });

  it('emits upper/middle/lower', () => {
    const buf = new CandleBuffer();
    for (let i = 0; i < 25; i++) buf.append(ohlcv(i + 1, 100, 100 + i, 100 - i, 100));
    const out = new Donchian(20).compute(buf);
    expect(out.map((s) => s.name)).toEqual(['upper', 'middle', 'lower']);
  });

  it('upper is the window max high, lower the window min low', () => {
    const buf = new CandleBuffer();
    // 5 candles with known highs/lows.
    buf.append(ohlcv(1, 10, 12, 8, 10));
    buf.append(ohlcv(2, 10, 15, 9, 10));
    buf.append(ohlcv(3, 10, 11, 5, 10));
    buf.append(ohlcv(4, 10, 14, 7, 10));
    buf.append(ohlcv(5, 10, 13, 6, 10));
    const [upper, middle, lower] = new Donchian(5).compute(buf);
    expect(upper!.values[4]).toBe(15);
    expect(lower!.values[4]).toBe(5);
    expect(middle!.values[4]).toBe((15 + 5) / 2);
  });
});

describe('Keltner', () => {
  it('throws on invalid args', () => {
    expect(() => new Keltner(0)).toThrow();
    expect(() => new Keltner(20, 0)).toThrow();
    expect(() => new Keltner(20, 2, 0)).toThrow();
  });

  it('id encodes period/mult/atrPeriod', () => {
    expect(new Keltner(20, 2, 10).id).toBe('keltner(20,2,10)');
  });

  it('emits upper/middle/lower with upper > middle > lower after warmup', () => {
    const buf = new CandleBuffer();
    for (let i = 0; i < 40; i++) {
      const base = 100 + Math.sin(i / 3) * 5;
      buf.append(ohlcv(i + 1, base, base + 2, base - 2, base));
    }
    const [upper, middle, lower] = new Keltner(20, 2, 10).compute(buf);
    const i = 39;
    expect(upper!.values[i]!).toBeGreaterThan(middle!.values[i]!);
    expect(middle!.values[i]!).toBeGreaterThan(lower!.values[i]!);
  });

  it('SMA sanity: a flat series yields a flat midline equal to price', () => {
    // EMA of a constant equals the constant; ATR of a constant-range
    // series is the range. Use truly flat OHLC so ATR → 0, bands collapse.
    const buf = closes(Array.from({ length: 30 }, () => 100));
    const sma = new SMA(20).compute(buf)[0]!;
    const [upper, middle, lower] = new Keltner(20, 2, 10).compute(buf);
    expect(middle!.values[29]).toBeCloseTo(100, 6);
    // ATR is 0 on a flat series → bands equal the midline.
    expect(upper!.values[29]).toBeCloseTo(100, 6);
    expect(lower!.values[29]).toBeCloseTo(100, 6);
    // And the midline tracks the SMA (both 100 on a flat series).
    expect(sma.values[29]).toBeCloseTo(100, 6);
  });
});
