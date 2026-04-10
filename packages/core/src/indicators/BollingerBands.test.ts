import { describe, it, expect } from 'vitest';
import { BollingerBands } from './BollingerBands';
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

describe('BollingerBands', () => {
  it('default parameters are period=20, stdDev=2', () => {
    const bb = new BollingerBands();
    expect(bb.id).toBe('bb(20,2)');
  });

  it('custom parameters in id', () => {
    expect(new BollingerBands(10, 2.5).id).toBe('bb(10,2.5)');
  });

  it('returns three series: upper, middle, lower', () => {
    const series = new BollingerBands(3, 2).compute(bufferOf([1, 2, 3, 4, 5]));
    const names = series.map((s) => s.name).sort();
    expect(names).toEqual(['lower', 'middle', 'upper']);
  });

  it('middle is the SMA', () => {
    // closes 1..5, period 3 — same SMA we tested in SMA.test.ts
    const series = new BollingerBands(3, 2).compute(bufferOf([1, 2, 3, 4, 5]));
    const middle = series.find((s) => s.name === 'middle')!.values;
    expect(middle[2]).toBeCloseTo(2);
    expect(middle[3]).toBeCloseTo(3);
    expect(middle[4]).toBeCloseTo(4);
  });

  it('upper > middle > lower when there is variance', () => {
    const series = new BollingerBands(3, 2).compute(bufferOf([1, 2, 3, 4, 5]));
    const upper = series.find((s) => s.name === 'upper')!.values;
    const middle = series.find((s) => s.name === 'middle')!.values;
    const lower = series.find((s) => s.name === 'lower')!.values;
    for (let i = 2; i < 5; i++) {
      expect(upper[i]!).toBeGreaterThan(middle[i]!);
      expect(middle[i]!).toBeGreaterThan(lower[i]!);
    }
  });

  it('upper/middle/lower all equal for flat input', () => {
    const series = new BollingerBands(3, 2).compute(bufferOf([100, 100, 100, 100, 100]));
    const upper = series.find((s) => s.name === 'upper')!.values;
    const middle = series.find((s) => s.name === 'middle')!.values;
    const lower = series.find((s) => s.name === 'lower')!.values;
    for (let i = 2; i < 5; i++) {
      expect(upper[i]).toBeCloseTo(100);
      expect(middle[i]).toBeCloseTo(100);
      expect(lower[i]).toBeCloseTo(100);
    }
  });

  it('band width scales with stdDev multiplier', () => {
    const closes = [1, 2, 3, 4, 5];
    const bb1 = new BollingerBands(3, 1).compute(bufferOf(closes));
    const bb2 = new BollingerBands(3, 2).compute(bufferOf(closes));
    const upper1 = bb1.find((s) => s.name === 'upper')!.values;
    const middle1 = bb1.find((s) => s.name === 'middle')!.values;
    const upper2 = bb2.find((s) => s.name === 'upper')!.values;
    const middle2 = bb2.find((s) => s.name === 'middle')!.values;
    const width1 = upper1[4]! - middle1[4]!;
    const width2 = upper2[4]! - middle2[4]!;
    expect(width2).toBeCloseTo(width1 * 2);
  });

  it('warmup: first period-1 values are NaN on all series', () => {
    const series = new BollingerBands(3, 2).compute(bufferOf([1, 2, 3, 4, 5]));
    for (const s of series) {
      expect(Number.isNaN(s.values[0]!)).toBe(true);
      expect(Number.isNaN(s.values[1]!)).toBe(true);
      expect(Number.isNaN(s.values[2]!)).toBe(false);
    }
  });

  it('placement is overlay', () => {
    expect(new BollingerBands().placement).toBe('overlay');
  });
});
