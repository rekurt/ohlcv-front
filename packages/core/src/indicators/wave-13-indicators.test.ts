import { describe, it, expect } from 'vitest';
import { PivotPoints } from './PivotPoints';
import { Ichimoku } from './Ichimoku';
import { MFI } from './MFI';
import { CandleBuffer } from '../data/CandleBuffer';
import type { Candle } from '../types';

function ohlcv(t: number, o: number, h: number, l: number, c: number, v = 1): Candle {
  return { o, h, l, c, v, t };
}

function bufferOf(rows: Candle[]): CandleBuffer {
  const buf = new CandleBuffer();
  for (const r of rows) buf.append(r);
  return buf;
}

describe('PivotPoints', () => {
  it('throws on non-positive period', () => {
    expect(() => new PivotPoints(0)).toThrow();
    expect(() => new PivotPoints(-1)).toThrow();
    expect(() => new PivotPoints(NaN)).toThrow();
  });

  it('id and placement', () => {
    const p = new PivotPoints(86400);
    expect(p.id).toBe('pp(86400)');
    expect(p.placement).toBe('overlay');
  });

  it('emits 5 series in canonical order', () => {
    const buf = bufferOf([ohlcv(1, 1, 2, 0, 1)]);
    const out = new PivotPoints(86400).compute(buf);
    expect(out.map((s) => s.name)).toEqual(['pivot', 'r1', 'r2', 's1', 's2']);
  });

  it('warmup NaN until the first bucket flip', () => {
    // All candles fall in the same 86400-second bucket.
    const buf = bufferOf([
      ohlcv(1, 100, 110, 90, 100),
      ohlcv(2, 100, 110, 90, 100),
      ohlcv(3, 100, 110, 90, 100),
    ]);
    const [pivot] = new PivotPoints(86400).compute(buf);
    expect(pivot!.values.every((v) => Number.isNaN(v))).toBe(true);
  });

  it('computes textbook pivots from the previous bucket HLC', () => {
    // Day 1: high=120, low=80, close=110. Pivot = (120+80+110)/3 = 103.33.
    // R1 = 2*103.33 - 80 = 126.67. S1 = 2*103.33 - 120 = 86.67.
    // Day 1 ends at t=86_399, Day 2 starts at t=86_400.
    const buf = bufferOf([
      ohlcv(60, 100, 120, 80, 110),
      ohlcv(86_400, 110, 115, 105, 112),
    ]);
    const out = new PivotPoints(86400).compute(buf);
    const [pivot, r1, , s1] = out;
    expect(pivot!.values[1]).toBeCloseTo((120 + 80 + 110) / 3, 5);
    expect(r1!.values[1]).toBeCloseTo(2 * ((120 + 80 + 110) / 3) - 80, 5);
    expect(s1!.values[1]).toBeCloseTo(2 * ((120 + 80 + 110) / 3) - 120, 5);
  });
});

describe('Ichimoku', () => {
  it('throws on non-positive periods', () => {
    expect(() => new Ichimoku(0, 26, 52, 26)).toThrow();
    expect(() => new Ichimoku(9, 0, 52, 26)).toThrow();
    expect(() => new Ichimoku(9, 26, 0, 26)).toThrow();
    expect(() => new Ichimoku(9, 26, 52, 0)).toThrow();
    expect(() => new Ichimoku(9.5, 26, 52, 26)).toThrow();
  });

  it('id encodes all four parameters', () => {
    expect(new Ichimoku(9, 26, 52, 26).id).toBe('ichimoku(9,26,52,26)');
    expect(new Ichimoku(7, 22, 44, 22).id).toBe('ichimoku(7,22,44,22)');
  });

  it('emits 5 series: tenkan, kijun, senkouA, senkouB, chikou', () => {
    const buf = bufferOf(
      Array.from({ length: 100 }, (_, i) =>
        ohlcv(i + 1, 100, 105, 95, 100),
      ),
    );
    const out = new Ichimoku().compute(buf);
    expect(out.map((s) => s.name)).toEqual([
      'tenkan',
      'kijun',
      'senkouA',
      'senkouB',
      'chikou',
    ]);
    expect(out[0]!.values.length).toBe(100);
  });

  it('warmup: tenkan NaN before period-1, then takes a value', () => {
    const buf = bufferOf(
      Array.from({ length: 20 }, (_, i) => ohlcv(i + 1, 100, 100 + i, 90, 100)),
    );
    const [tenkan] = new Ichimoku(9, 26, 52, 26).compute(buf);
    // tenkan warmup = 8; index 8 should be the first finite value.
    expect(Number.isNaN(tenkan!.values[7]!)).toBe(true);
    expect(Number.isFinite(tenkan!.values[8]!)).toBe(true);
  });

  it('chikou shifts close back by displacement', () => {
    const buf = bufferOf(
      Array.from({ length: 30 }, (_, i) =>
        ohlcv(i + 1, 100 + i, 100 + i, 100 + i, 100 + i),
      ),
    );
    const [, , , , chikou] = new Ichimoku(9, 26, 52, 5).compute(buf);
    // chikou[i] = close[i + displacement].
    // close[5] = 105, so chikou[0] should be 105.
    expect(chikou!.values[0]).toBe(105);
    // close[15] = 115, so chikou[10] should be 115.
    expect(chikou!.values[10]).toBe(115);
  });
});

describe('MFI', () => {
  it('throws on invalid period', () => {
    expect(() => new MFI(0)).toThrow();
    expect(() => new MFI(1)).toThrow();
    expect(() => new MFI(1.5)).toThrow();
  });

  it('id and placement', () => {
    const m = new MFI(14);
    expect(m.id).toBe('mfi(14)');
    expect(m.placement).toBe('pane');
  });

  it('warmup NaN before period+1 bars', () => {
    const buf = bufferOf(
      Array.from({ length: 5 }, (_, i) =>
        ohlcv(i + 1, 100, 105, 95, 100, 10),
      ),
    );
    const [s] = new MFI(14).compute(buf);
    expect(s!.values.every((v) => Number.isNaN(v))).toBe(true);
  });

  it('returns 100 when all positive flow (no down ticks in window)', () => {
    // Strictly increasing typical price every bar → negative flow == 0.
    const buf = bufferOf(
      Array.from({ length: 20 }, (_, i) =>
        ohlcv(i + 1, 100 + i, 100 + i, 100 + i, 100 + i, 10),
      ),
    );
    const [s] = new MFI(14).compute(buf);
    expect(s!.values[19]).toBe(100);
  });

  it('produces values in [0, 100] for a mixed series', () => {
    const buf = bufferOf(
      Array.from({ length: 30 }, (_, i) => {
        const c = 100 + Math.sin(i / 2) * 10;
        return ohlcv(i + 1, c, c + 1, c - 1, c, 100);
      }),
    );
    const [s] = new MFI(14).compute(buf);
    for (let i = 15; i < 30; i++) {
      const v = s!.values[i]!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});
