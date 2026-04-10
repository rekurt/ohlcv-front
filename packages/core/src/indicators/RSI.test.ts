import { describe, it, expect } from 'vitest';
import { RSI } from './RSI';
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

describe('RSI', () => {
  it('throws on invalid period', () => {
    expect(() => new RSI(0)).toThrow();
    expect(() => new RSI(1)).toThrow();
    expect(() => new RSI(1.5)).toThrow();
  });

  it('id includes period', () => {
    expect(new RSI(14).id).toBe('rsi(14)');
  });

  it('placement is pane (sub-pane required)', () => {
    expect(new RSI(14).placement).toBe('pane');
  });

  it('returns single series named "rsi"', () => {
    const buf = bufferOf(new Array(20).fill(0).map((_, i) => 100 + i));
    const series = new RSI(14).compute(buf);
    expect(series).toHaveLength(1);
    expect(series[0]!.name).toBe('rsi');
  });

  it('all values in [0, 100] range when data is non-trivial', () => {
    const closes = [
      44, 44.25, 44.5, 43.75, 44.5, 45, 45.25, 45.75, 46, 46.5, 45.75, 46, 46.5, 47, 47.25, 46.75,
      47, 47.25, 47.75, 47, 46.5, 46.75, 47.25, 48, 48.25,
    ];
    const series = new RSI(14).compute(bufferOf(closes));
    const values = series[0]!.values;
    for (let i = 14; i < values.length; i++) {
      expect(values[i]!).toBeGreaterThanOrEqual(0);
      expect(values[i]!).toBeLessThanOrEqual(100);
    }
  });

  it('warmup: first `period` values are NaN', () => {
    const closes = new Array(30).fill(0).map((_, i) => 100 + Math.sin(i));
    const values = new RSI(14).compute(bufferOf(closes))[0]!.values;
    for (let i = 0; i < 14; i++) {
      expect(Number.isNaN(values[i]!)).toBe(true);
    }
    expect(Number.isNaN(values[14]!)).toBe(false);
  });

  it('RSI approaches 100 for continuously rising prices', () => {
    const closes = new Array(30).fill(0).map((_, i) => 100 + i);
    const values = new RSI(14).compute(bufferOf(closes))[0]!.values;
    // All positive differences → avgLoss = 0 → RSI = 100
    expect(values[15]).toBeCloseTo(100);
    expect(values[29]).toBeCloseTo(100);
  });

  it('RSI approaches 0 for continuously falling prices', () => {
    const closes = new Array(30).fill(0).map((_, i) => 100 - i);
    const values = new RSI(14).compute(bufferOf(closes))[0]!.values;
    // All negative differences → avgGain = 0 → RSI = 0
    expect(values[15]).toBeCloseTo(0);
    expect(values[29]).toBeCloseTo(0);
  });

  it('handles buffer shorter than period', () => {
    const values = new RSI(14).compute(bufferOf([1, 2, 3]))[0]!.values;
    expect(values.every((v) => Number.isNaN(v))).toBe(true);
  });

  it('handles empty buffer', () => {
    const values = new RSI(14).compute(new CandleBuffer())[0]!.values;
    expect(values).toHaveLength(0);
  });
});
