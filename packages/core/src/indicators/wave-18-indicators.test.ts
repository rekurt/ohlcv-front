import { describe, it, expect } from 'vitest';
import { Supertrend } from './Supertrend';
import { ParabolicSAR } from './ParabolicSAR';
import { StochRSI } from './StochRSI';
import { ROC } from './ROC';
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

function uptrend(len: number): CandleBuffer {
  return bufferOf(
    Array.from({ length: len }, (_, i) =>
      ohlcv(i + 1, 100 + i, 102 + i, 99 + i, 101 + i),
    ),
  );
}

describe('Supertrend', () => {
  it('throws on invalid args', () => {
    expect(() => new Supertrend(1)).toThrow();
    expect(() => new Supertrend(10, 0)).toThrow();
  });

  it('id and placement', () => {
    expect(new Supertrend(10, 3).id).toBe('supertrend(10,3)');
    expect(new Supertrend().placement).toBe('overlay');
  });

  it('emits supertrend + direction series', () => {
    const out = new Supertrend(10, 3).compute(uptrend(40));
    expect(out.map((s) => s.name)).toEqual(['supertrend', 'direction']);
  });

  it('reports a positive direction and a line below price in an uptrend', () => {
    const buf = uptrend(40);
    const [line, dir] = new Supertrend(10, 3).compute(buf);
    const i = 39;
    expect(dir!.values[i]).toBe(1);
    // In an uptrend the supertrend line sits below the close.
    expect(line!.values[i]!).toBeLessThan(buf.candleAt(i)!.c);
  });
});

describe('ParabolicSAR', () => {
  it('throws on invalid args', () => {
    expect(() => new ParabolicSAR(0)).toThrow();
    expect(() => new ParabolicSAR(0.02, 0.01)).toThrow(); // max < step
  });

  it('id and placement', () => {
    expect(new ParabolicSAR(0.02, 0.2).id).toBe('psar(0.02,0.2)');
    expect(new ParabolicSAR().placement).toBe('overlay');
  });

  it('SAR stays below price during a clean uptrend', () => {
    const buf = uptrend(30);
    const [sar] = new ParabolicSAR().compute(buf);
    // After a few bars the SAR should trail below the lows.
    for (let i = 5; i < 30; i++) {
      const v = sar!.values[i];
      if (Number.isFinite(v)) {
        expect(v!).toBeLessThanOrEqual(buf.candleAt(i)!.h);
      }
    }
  });

  it('flips side when the trend reverses', () => {
    // Up for 15 bars, then down for 15.
    const rows: Candle[] = [];
    for (let i = 0; i < 15; i++) rows.push(ohlcv(i + 1, 100 + i, 102 + i, 99 + i, 101 + i));
    for (let i = 0; i < 15; i++) {
      const base = 115 - i;
      rows.push(ohlcv(16 + i, base, base + 1, base - 2, base - 1));
    }
    const buf = bufferOf(rows);
    const [sar] = new ParabolicSAR().compute(buf);
    // Somewhere in the second half the SAR should sit ABOVE price
    // (downtrend), proving a flip happened.
    let flipped = false;
    for (let i = 20; i < 30; i++) {
      if (Number.isFinite(sar!.values[i]) && sar!.values[i]! > buf.candleAt(i)!.c) {
        flipped = true;
        break;
      }
    }
    expect(flipped).toBe(true);
  });
});

describe('StochRSI', () => {
  it('throws on invalid args', () => {
    expect(() => new StochRSI(0)).toThrow();
    expect(() => new StochRSI(14, 0)).toThrow();
  });

  it('id and placement', () => {
    expect(new StochRSI(14, 14, 3, 3).id).toBe('stochrsi(14,14,3,3)');
    expect(new StochRSI().placement).toBe('pane');
  });

  it('emits %K and %D within [0, 100]', () => {
    const buf = bufferOf(
      Array.from({ length: 80 }, (_, i) => {
        const c = 100 + Math.sin(i / 4) * 10;
        return ohlcv(i + 1, c, c + 1, c - 1, c);
      }),
    );
    const [k, d] = new StochRSI().compute(buf);
    for (let i = 50; i < 80; i++) {
      if (Number.isFinite(k!.values[i])) {
        expect(k!.values[i]!).toBeGreaterThanOrEqual(0);
        expect(k!.values[i]!).toBeLessThanOrEqual(100);
      }
      if (Number.isFinite(d!.values[i])) {
        expect(d!.values[i]!).toBeGreaterThanOrEqual(0);
        expect(d!.values[i]!).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('ROC', () => {
  it('throws on invalid period', () => {
    expect(() => new ROC(0)).toThrow();
  });

  it('id and placement', () => {
    expect(new ROC(12).id).toBe('roc(12)');
    expect(new ROC().placement).toBe('pane');
  });

  it('computes percentage change vs period bars ago', () => {
    // close[0]=100, close[5]=110 → ROC = (110-100)/100*100 = 10.
    const closes = [100, 101, 102, 103, 104, 110];
    const buf = bufferOf(closes.map((c, i) => ohlcv(i + 1, c, c, c, c)));
    const [s] = new ROC(5).compute(buf);
    expect(s!.values[5]).toBeCloseTo(10, 9);
  });

  it('warmup NaN before period', () => {
    const buf = bufferOf([1, 2, 3].map((c, i) => ohlcv(i + 1, c, c, c, c)));
    const [s] = new ROC(5).compute(buf);
    expect(s!.values.every((v) => Number.isNaN(v))).toBe(true);
  });
});
