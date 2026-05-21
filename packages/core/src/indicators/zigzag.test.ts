import { describe, it, expect } from 'vitest';
import { ZigZag } from './ZigZag';
import { createIndicator, indicatorId } from './registry';
import { CandleBuffer } from '../data/CandleBuffer';
import type { Candle } from '../types';

function ohlc(t: number, h: number, l: number, c: number): Candle {
  return { o: c, h, l, c, v: 1, t };
}

function bufferOf(rows: Candle[]): CandleBuffer {
  const buf = new CandleBuffer();
  for (const r of rows) buf.append(r);
  return buf;
}

describe('ZigZag', () => {
  it('throws on invalid deviation', () => {
    expect(() => new ZigZag(0)).toThrow();
    expect(() => new ZigZag(-1)).toThrow();
  });

  it('id and placement', () => {
    expect(new ZigZag(5).id).toBe('zigzag(5)');
    expect(new ZigZag().placement).toBe('overlay');
  });

  it('registry wiring', () => {
    expect(indicatorId({ type: 'zigzag' })).toBe('zigzag:5');
    expect(indicatorId({ type: 'zigzag', deviation: 3 })).toBe('zigzag:3');
    expect(createIndicator({ type: 'zigzag' })).toBeInstanceOf(ZigZag);
  });

  it('marks swing pivots and leaves NaN between them', () => {
    // Up to 120, down to 80, up to 130 — clear swings at >5% deviation.
    const rows: Candle[] = [];
    // rise 100 → 120
    for (let i = 0; i <= 20; i++) rows.push(ohlc(i + 1, 100 + i, 99 + i, 100 + i));
    // fall 120 → 80
    for (let i = 1; i <= 40; i++) rows.push(ohlc(21 + i, 121 - i, 119 - i, 120 - i));
    // rise 80 → 130
    for (let i = 1; i <= 50; i++) rows.push(ohlc(61 + i, 81 + i, 79 + i, 80 + i));
    const buf = bufferOf(rows);
    const [s] = new ZigZag(5).compute(buf);

    const pivots = [];
    for (let i = 0; i < s!.values.length; i++) {
      if (Number.isFinite(s!.values[i])) pivots.push({ i, v: s!.values[i]! });
    }
    // Expect at least 3 pivots: a high near 120, a low near 80, and the
    // final running high near 130.
    expect(pivots.length).toBeGreaterThanOrEqual(3);
    const prices = pivots.map((p) => p.v);
    expect(Math.max(...prices)).toBeGreaterThan(120);
    expect(Math.min(...prices)).toBeLessThan(85);
  });

  it('handles a tiny buffer without throwing', () => {
    const [s] = new ZigZag().compute(bufferOf([ohlc(1, 10, 9, 10)]));
    expect(s!.values.length).toBe(1);
  });
});
