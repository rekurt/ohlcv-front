import { describe, it, expect } from 'vitest';
import { MACD } from './MACD';
import { Stochastic } from './Stochastic';
import { ATR } from './ATR';
import { VWAP } from './VWAP';
import { CandleBuffer } from '../data/CandleBuffer';
import type { Candle } from '../types';

function candle(i: number, o: number, h: number, l: number, c: number, v = 1): Candle {
  return { o, h, l, c, v, t: 1_700_000_000 + i * 60 };
}

function bufferOfCloses(closes: number[]): CandleBuffer {
  const buf = new CandleBuffer();
  closes.forEach((c, i) => buf.append(candle(i, c, c, c, c)));
  return buf;
}

describe('MACD', () => {
  it('throws on invalid periods', () => {
    expect(() => new MACD(0, 26, 9)).toThrow();
    expect(() => new MACD(12, 26, 1)).toThrow();
    expect(() => new MACD(26, 26, 9)).toThrow(); // fast must be < slow
    expect(() => new MACD(30, 26, 9)).toThrow();
  });

  it('id encodes all three periods', () => {
    expect(new MACD(12, 26, 9).id).toBe('macd(12,26,9)');
  });

  it('placement is pane', () => {
    expect(new MACD().placement).toBe('pane');
  });

  it('returns three series: macd, signal, histogram', () => {
    const buf = bufferOfCloses(new Array(100).fill(0).map((_, i) => 100 + i));
    const series = new MACD().compute(buf);
    const names = series.map((s) => s.name).sort();
    expect(names).toEqual(['histogram', 'macd', 'signal']);
  });

  it('all series aligned with buffer length', () => {
    const buf = bufferOfCloses(new Array(50).fill(0).map((_, i) => 100 + i));
    const series = new MACD(12, 26, 9).compute(buf);
    for (const s of series) expect(s.values).toHaveLength(50);
  });

  it('warmup: macd is NaN before slow period', () => {
    const buf = bufferOfCloses(new Array(50).fill(0).map((_, i) => 100 + i));
    const series = new MACD(12, 26, 9).compute(buf);
    const macd = series.find((s) => s.name === 'macd')!.values;
    for (let i = 0; i < 25; i++) {
      expect(Number.isNaN(macd[i]!)).toBe(true);
    }
    expect(Number.isNaN(macd[25]!)).toBe(false);
  });

  it('histogram = macd − signal for valid positions', () => {
    const buf = bufferOfCloses(new Array(100).fill(0).map((_, i) => 100 + i + Math.sin(i) * 5));
    const [macd, signal, histogram] = new MACD(12, 26, 9).compute(buf);
    for (let i = 40; i < macd!.values.length; i++) {
      if (
        !Number.isNaN(macd!.values[i]!) &&
        !Number.isNaN(signal!.values[i]!)
      ) {
        expect(histogram!.values[i]!).toBeCloseTo(macd!.values[i]! - signal!.values[i]!);
      }
    }
  });

  it('all-NaN when buffer shorter than slow period', () => {
    const buf = bufferOfCloses([1, 2, 3]);
    const series = new MACD(12, 26, 9).compute(buf);
    for (const s of series) {
      expect(s.values.every((v) => Number.isNaN(v))).toBe(true);
    }
  });
});

describe('Stochastic', () => {
  it('throws on invalid periods', () => {
    expect(() => new Stochastic(0, 3)).toThrow();
    expect(() => new Stochastic(14, 0)).toThrow();
  });

  it('id encodes both periods', () => {
    expect(new Stochastic(14, 3).id).toBe('stoch(14,3)');
  });

  it('placement is pane', () => {
    expect(new Stochastic().placement).toBe('pane');
  });

  it('returns two series: k, d', () => {
    const buf = bufferOfCloses(new Array(30).fill(0).map((_, i) => 100 + i));
    const series = new Stochastic(14, 3).compute(buf);
    expect(series.map((s) => s.name).sort()).toEqual(['d', 'k']);
  });

  it('values clamped to [0, 100]', () => {
    const closes = new Array(50).fill(0).map((_, i) => 100 + Math.sin(i) * 10);
    const buf = bufferOfCloses(closes);
    const [k, d] = new Stochastic(14, 3).compute(buf);
    for (let i = 13; i < 50; i++) {
      if (!Number.isNaN(k!.values[i]!)) {
        expect(k!.values[i]!).toBeGreaterThanOrEqual(0);
        expect(k!.values[i]!).toBeLessThanOrEqual(100);
      }
      if (!Number.isNaN(d!.values[i]!)) {
        expect(d!.values[i]!).toBeGreaterThanOrEqual(0);
        expect(d!.values[i]!).toBeLessThanOrEqual(100);
      }
    }
  });

  it('k hits 100 when close is at the window high', () => {
    // Rising prices — last close equals the highest high of the window
    const closes = new Array(20).fill(0).map((_, i) => 100 + i);
    const buf = bufferOfCloses(closes);
    const [k] = new Stochastic(14, 3).compute(buf);
    expect(k!.values[19]).toBe(100);
  });

  it('k hits 0 when close is at the window low', () => {
    const closes = new Array(20).fill(0).map((_, i) => 100 - i);
    const buf = bufferOfCloses(closes);
    const [k] = new Stochastic(14, 3).compute(buf);
    expect(k!.values[19]).toBe(0);
  });

  it('k is 100 when range is zero (flat window)', () => {
    const closes = new Array(20).fill(100);
    const buf = bufferOfCloses(closes);
    const [k] = new Stochastic(14, 3).compute(buf);
    expect(k!.values[19]).toBe(100);
  });
});

describe('ATR', () => {
  it('throws on invalid period', () => {
    expect(() => new ATR(0)).toThrow();
    expect(() => new ATR(1)).toThrow();
  });

  it('id encodes the period', () => {
    expect(new ATR(14).id).toBe('atr(14)');
  });

  it('placement is pane', () => {
    expect(new ATR().placement).toBe('pane');
  });

  it('warmup: first `period` values are NaN', () => {
    const buf = bufferOfCloses(new Array(30).fill(0).map((_, i) => 100 + i));
    const [atr] = new ATR(14).compute(buf);
    for (let i = 0; i < 14; i++) expect(Number.isNaN(atr!.values[i]!)).toBe(true);
    expect(Number.isNaN(atr!.values[14]!)).toBe(false);
  });

  it('ATR is positive for volatile data', () => {
    const closes = new Array(50).fill(0).map((_, i) => 100 + Math.sin(i) * 10);
    const buf = bufferOfCloses(closes);
    const [atr] = new ATR(14).compute(buf);
    for (let i = 15; i < 50; i++) {
      expect(atr!.values[i]!).toBeGreaterThan(0);
    }
  });

  it('returns empty values for buffer shorter than period', () => {
    const buf = bufferOfCloses([1, 2, 3]);
    const [atr] = new ATR(14).compute(buf);
    expect(atr!.values.every((v) => Number.isNaN(v))).toBe(true);
  });
});

describe('VWAP', () => {
  it('id encodes the anchor', () => {
    expect(new VWAP('session').id).toBe('vwap(session)');
    expect(new VWAP('cumulative').id).toBe('vwap(cumulative)');
  });

  it('placement is overlay', () => {
    expect(new VWAP().placement).toBe('overlay');
  });

  it('first candle VWAP equals its own typical price', () => {
    const buf = new CandleBuffer();
    buf.append(candle(0, 100, 110, 90, 105, 1000));
    const [vwap] = new VWAP('cumulative').compute(buf);
    // typical = (110 + 90 + 105) / 3 = 101.666...
    expect(vwap!.values[0]).toBeCloseTo((110 + 90 + 105) / 3);
  });

  it('cumulative anchor accumulates across all candles', () => {
    const buf = new CandleBuffer();
    buf.append(candle(0, 100, 110, 90, 100, 100));   // typical 100
    buf.append(candle(1, 100, 120, 100, 110, 200));  // typical 110
    const [vwap] = new VWAP('cumulative').compute(buf);
    // (100*100 + 110*200) / 300 = (10000 + 22000) / 300 = 106.666...
    expect(vwap!.values[1]).toBeCloseTo(32_000 / 300);
  });

  it('session anchor resets on UTC day boundary', () => {
    const SECONDS_PER_DAY = 86_400;
    const buf = new CandleBuffer();
    // Day 0 close
    buf.append({ o: 100, h: 110, l: 90, c: 100, v: 100, t: SECONDS_PER_DAY - 60 });
    // Day 1 open
    buf.append({ o: 200, h: 220, l: 180, c: 200, v: 200, t: SECONDS_PER_DAY });
    const [vwap] = new VWAP('session').compute(buf);
    // Day 0: typical 100 → vwap 100
    expect(vwap!.values[0]).toBeCloseTo(100);
    // Day 1: reset, typical 200 → vwap 200 (not the cumulative 166.66)
    expect(vwap!.values[1]).toBeCloseTo(200);
  });

  it('handles empty buffer', () => {
    const [vwap] = new VWAP().compute(new CandleBuffer());
    expect(vwap!.values).toHaveLength(0);
  });

  it('handles zero-volume candles without dividing by zero', () => {
    const buf = new CandleBuffer();
    buf.append(candle(0, 100, 100, 100, 100, 0));
    const [vwap] = new VWAP('cumulative').compute(buf);
    expect(Number.isNaN(vwap!.values[0]!)).toBe(true);
  });

  describe('anchored mode', () => {
    it('id encodes the anchor timestamp', () => {
      expect(new VWAP({ type: 'anchored', t: 1700000000 }).id).toBe(
        'vwap(anchored:1700000000)',
      );
    });

    it('throws on a non-positive or non-finite anchor t', () => {
      expect(() => new VWAP({ type: 'anchored', t: 0 })).toThrow();
      expect(() => new VWAP({ type: 'anchored', t: -1 })).toThrow();
      expect(() => new VWAP({ type: 'anchored', t: NaN })).toThrow();
    });

    it('emits NaN for candles before the anchor and accumulates from the anchor', () => {
      const buf = new CandleBuffer();
      // Three pre-anchor candles, then three post-anchor candles.
      const anchor = 1_700_000_180; // candle index 3
      buf.append(candle(0, 100, 100, 100, 100, 100));
      buf.append(candle(1, 100, 100, 100, 100, 100));
      buf.append(candle(2, 100, 100, 100, 100, 100));
      buf.append(candle(3, 200, 200, 200, 200, 100));
      buf.append(candle(4, 210, 210, 210, 210, 100));
      buf.append(candle(5, 190, 190, 190, 190, 100));
      const [vwap] = new VWAP({ type: 'anchored', t: anchor }).compute(buf);
      expect(Number.isNaN(vwap!.values[0]!)).toBe(true);
      expect(Number.isNaN(vwap!.values[2]!)).toBe(true);
      // First post-anchor candle: vwap = typical = 200.
      expect(vwap!.values[3]).toBeCloseTo(200);
      // Cumulative from anchor: (200+210)/2 = 205.
      expect(vwap!.values[4]).toBeCloseTo(205);
      // (200+210+190)/3 = 200.
      expect(vwap!.values[5]).toBeCloseTo(200);
    });

    it('anchor in the future leaves all values NaN', () => {
      const buf = new CandleBuffer();
      buf.append(candle(0, 100, 100, 100, 100, 10));
      buf.append(candle(1, 100, 100, 100, 100, 10));
      const [vwap] = new VWAP({ type: 'anchored', t: 9_999_999_999 }).compute(buf);
      expect(vwap!.values.every((v) => Number.isNaN(v))).toBe(true);
    });
  });
});
