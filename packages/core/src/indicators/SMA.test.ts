import { describe, it, expect } from 'vitest';
import { SMA } from './SMA';
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

describe('SMA', () => {
  it('throws on invalid period', () => {
    expect(() => new SMA(0)).toThrow();
    expect(() => new SMA(-1)).toThrow();
    expect(() => new SMA(1.5)).toThrow();
  });

  it('id includes period', () => {
    expect(new SMA(20).id).toBe('sma(20)');
  });

  it('placement is overlay', () => {
    expect(new SMA(5).placement).toBe('overlay');
  });

  it('returns a single series named "sma"', () => {
    const result = new SMA(3).compute(bufferOf([1, 2, 3, 4, 5]));
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('sma');
  });

  it('output length matches buffer length', () => {
    const result = new SMA(3).compute(bufferOf([1, 2, 3, 4, 5]));
    expect(result[0]!.values).toHaveLength(5);
  });

  it('first (period-1) values are NaN (warmup)', () => {
    const values = new SMA(3).compute(bufferOf([1, 2, 3, 4, 5]))[0]!.values;
    expect(Number.isNaN(values[0]!)).toBe(true);
    expect(Number.isNaN(values[1]!)).toBe(true);
    expect(Number.isNaN(values[2]!)).toBe(false);
  });

  it('computes correct averages', () => {
    // closes: 1, 2, 3, 4, 5 with period 3
    // sma[2] = (1+2+3)/3 = 2
    // sma[3] = (2+3+4)/3 = 3
    // sma[4] = (3+4+5)/3 = 4
    const values = new SMA(3).compute(bufferOf([1, 2, 3, 4, 5]))[0]!.values;
    expect(values[2]).toBeCloseTo(2);
    expect(values[3]).toBeCloseTo(3);
    expect(values[4]).toBeCloseTo(4);
  });

  it('handles period equal to buffer length', () => {
    const values = new SMA(5).compute(bufferOf([1, 2, 3, 4, 5]))[0]!.values;
    expect(Number.isNaN(values[3]!)).toBe(true);
    expect(values[4]).toBeCloseTo(3);
  });

  it('handles period longer than buffer (all NaN)', () => {
    const values = new SMA(10).compute(bufferOf([1, 2, 3]))[0]!.values;
    expect(values).toHaveLength(3);
    expect(values.every((v) => Number.isNaN(v))).toBe(true);
  });

  it('returns empty-aligned series for empty buffer', () => {
    const values = new SMA(3).compute(new CandleBuffer())[0]!.values;
    expect(values).toHaveLength(0);
  });
});
