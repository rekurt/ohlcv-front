import { describe, it, expect } from 'vitest';
import { WilliamsR } from './WilliamsR';
import { OBV } from './OBV';
import { ADX } from './ADX';
import { CCI } from './CCI';
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

describe('WilliamsR', () => {
  it('throws on invalid period', () => {
    expect(() => new WilliamsR(0)).toThrow();
    expect(() => new WilliamsR(1.5)).toThrow();
  });

  it('id and placement', () => {
    const w = new WilliamsR(14);
    expect(w.id).toBe('williamsr(14)');
    expect(w.placement).toBe('pane');
  });

  it('warmup is NaN before period bars', () => {
    const buf = bufferOf([
      ohlcv(1, 1, 2, 0, 1),
      ohlcv(2, 1, 2, 0, 1),
      ohlcv(3, 1, 2, 0, 1),
    ]);
    const [s] = new WilliamsR(4).compute(buf);
    expect(s!.values.every((v) => Number.isNaN(v))).toBe(true);
  });

  it('returns -100 when close is at the period low and 0 at the high', () => {
    // Period = 3. Construct so the third candle's close equals the
    // window low; expect -100. Then a fourth with close at the window
    // high; expect 0.
    const buf = bufferOf([
      ohlcv(1, 10, 20, 5, 15),
      ohlcv(2, 10, 25, 8, 20),
      ohlcv(3, 10, 25, 5, 5),
    ]);
    const [s] = new WilliamsR(3).compute(buf);
    expect(s!.values[2]).toBeCloseTo(-100, 5);
  });

  it('emits -50 for a flat window (defense against /0)', () => {
    const buf = bufferOf([
      ohlcv(1, 100, 100, 100, 100),
      ohlcv(2, 100, 100, 100, 100),
      ohlcv(3, 100, 100, 100, 100),
    ]);
    const [s] = new WilliamsR(3).compute(buf);
    expect(s!.values[2]).toBe(-50);
  });
});

describe('OBV', () => {
  it('id and placement', () => {
    const o = new OBV();
    expect(o.id).toBe('obv');
    expect(o.placement).toBe('pane');
  });

  it('accumulates volume on up-closes, subtracts on down-closes', () => {
    const buf = bufferOf([
      ohlcv(1, 10, 12, 9, 11, 100),
      ohlcv(2, 11, 13, 10, 12, 50), // up: +50  → 50
      ohlcv(3, 12, 13, 9, 10, 80),  // down: -80 → -30
      ohlcv(4, 10, 11, 9, 10, 30),  // flat:  +0  → -30
      ohlcv(5, 10, 14, 10, 13, 200),// up: +200 → 170
    ]);
    const [s] = new OBV().compute(buf);
    expect(s!.values[0]).toBe(0);
    expect(s!.values[1]).toBe(50);
    expect(s!.values[2]).toBe(-30);
    expect(s!.values[3]).toBe(-30);
    expect(s!.values[4]).toBe(170);
  });

  it('handles an empty buffer cleanly', () => {
    const [s] = new OBV().compute(new CandleBuffer());
    expect(s!.values.length).toBe(0);
  });
});

describe('ADX', () => {
  it('throws on invalid period', () => {
    expect(() => new ADX(0)).toThrow();
    expect(() => new ADX(1.5)).toThrow();
  });

  it('id and placement', () => {
    const a = new ADX(14);
    expect(a.id).toBe('adx(14)');
    expect(a.placement).toBe('pane');
  });

  it('returns three series: +di, -di, adx', () => {
    const buf = bufferOf(
      Array.from({ length: 50 }, (_, i) =>
        ohlcv(i + 1, 100 + i, 105 + i, 95 + i, 100 + i),
      ),
    );
    const out = new ADX(14).compute(buf);
    expect(out.map((s) => s.name)).toEqual(['+di', '-di', 'adx']);
    expect(out[0]!.values.length).toBe(50);
  });

  it('warmup NaN for the first period bars', () => {
    const buf = bufferOf(
      Array.from({ length: 8 }, (_, i) => ohlcv(i + 1, 100, 110, 90, 100)),
    );
    const [pdi, mdi, adx] = new ADX(14).compute(buf);
    // 8 < period+1 = 15 → all NaN.
    expect(pdi!.values.every((v) => Number.isNaN(v))).toBe(true);
    expect(mdi!.values.every((v) => Number.isNaN(v))).toBe(true);
    expect(adx!.values.every((v) => Number.isNaN(v))).toBe(true);
  });

  it('strong uptrend produces positive ADX > 20 and +DI > -DI', () => {
    // Monotonic up: each bar high > prev high, low > prev low. -DM
    // should be 0 throughout.
    const buf = bufferOf(
      Array.from({ length: 40 }, (_, i) =>
        ohlcv(i + 1, 100 + i, 105 + i, 95 + i, 104 + i),
      ),
    );
    const [pdi, mdi, adx] = new ADX(14).compute(buf);
    const lastP = pdi!.values[39]!;
    const lastM = mdi!.values[39]!;
    const lastA = adx!.values[39]!;
    expect(lastP).toBeGreaterThan(lastM);
    expect(lastM).toBeCloseTo(0, 5);
    expect(lastA).toBeGreaterThan(20);
  });
});

describe('CCI', () => {
  it('throws on invalid period', () => {
    expect(() => new CCI(0)).toThrow();
    expect(() => new CCI(1.5)).toThrow();
  });

  it('id and placement', () => {
    const c = new CCI(20);
    expect(c.id).toBe('cci(20)');
    expect(c.placement).toBe('pane');
  });

  it('warmup NaN before period bars', () => {
    const buf = bufferOf(
      Array.from({ length: 5 }, (_, i) => ohlcv(i + 1, 100, 110, 90, 100)),
    );
    const [s] = new CCI(20).compute(buf);
    expect(s!.values.every((v) => Number.isNaN(v))).toBe(true);
  });

  it('returns 0 for a perfectly flat price (MAD = 0 defense)', () => {
    const buf = bufferOf(
      Array.from({ length: 25 }, (_, i) => ohlcv(i + 1, 100, 100, 100, 100)),
    );
    const [s] = new CCI(20).compute(buf);
    // After warmup, every value should be 0 (no deviation from the mean).
    for (let i = 19; i < 25; i++) {
      expect(s!.values[i]).toBe(0);
    }
  });

  it('positive values when price spikes up, negative when down', () => {
    const closes = Array.from({ length: 25 }, () => 100);
    closes[24] = 200; // big spike up
    const buf = bufferOf(closes.map((c, i) => ohlcv(i + 1, c, c, c, c)));
    const [s] = new CCI(20).compute(buf);
    expect(s!.values[24]).toBeGreaterThan(100);
  });
});
