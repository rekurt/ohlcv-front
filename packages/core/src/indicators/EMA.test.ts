import { describe, it, expect } from 'vitest';
import { EMA } from './EMA';
import { CandleBuffer } from '../data/CandleBuffer';
import type { Candle } from '../types';

function makeCandle(i: number, close: number): Candle {
  return { o: close, h: close, l: close, c: close, v: 1, t: 1_700_000_000 + i * 60 };
}

function bufferOf(closes: number[]): CandleBuffer {
  const buf = new CandleBuffer();
  closes.forEach((c, i) => buf.append(makeCandle(i, c)));
  return buf;
}

describe('EMA', () => {
  it('throws on invalid period', () => {
    expect(() => new EMA(0)).toThrow();
    expect(() => new EMA(1)).toThrow(); // period must be >= 2
  });

  it('id includes period', () => {
    expect(new EMA(20).id).toBe('ema(20)');
  });

  it('warmup mirrors SMA (first period-1 values are NaN)', () => {
    const values = new EMA(3).compute(bufferOf([1, 2, 3, 4, 5]))[0]!.values;
    expect(Number.isNaN(values[0]!)).toBe(true);
    expect(Number.isNaN(values[1]!)).toBe(true);
    expect(Number.isNaN(values[2]!)).toBe(false);
  });

  it('seeds EMA[period-1] with SMA of first `period` closes', () => {
    // closes 1..5, period 3 → seed = (1+2+3)/3 = 2
    const values = new EMA(3).compute(bufferOf([1, 2, 3, 4, 5]))[0]!.values;
    expect(values[2]).toBeCloseTo(2);
  });

  it('subsequent values follow EMA recurrence', () => {
    // period=3, multiplier k = 2/(3+1) = 0.5
    // ema[2] = 2 (seed)
    // ema[3] = close[3]*k + ema[2]*(1-k) = 4*0.5 + 2*0.5 = 3
    // ema[4] = 5*0.5 + 3*0.5 = 4
    const values = new EMA(3).compute(bufferOf([1, 2, 3, 4, 5]))[0]!.values;
    expect(values[3]).toBeCloseTo(3);
    expect(values[4]).toBeCloseTo(4);
  });

  it('converges to flat value for flat input', () => {
    const values = new EMA(5).compute(bufferOf([100, 100, 100, 100, 100, 100, 100, 100]))[0]!.values;
    for (let i = 4; i < values.length; i++) {
      expect(values[i]).toBeCloseTo(100);
    }
  });

  it('handles period longer than buffer', () => {
    const values = new EMA(10).compute(bufferOf([1, 2, 3]))[0]!.values;
    expect(values.every((v) => Number.isNaN(v))).toBe(true);
  });
});
