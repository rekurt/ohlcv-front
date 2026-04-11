import { describe, it, expect } from 'vitest';
import { toHeikinAshi, advanceHeikinAshi } from './heikinAshi';
import { toRenko } from './renko';
import type { Candle } from '../types';

function candle(t: number, o: number, h: number, l: number, c: number, v = 1): Candle {
  return { o, h, l, c, v, t };
}

describe('toHeikinAshi', () => {
  it('returns empty array for empty input', () => {
    expect(toHeikinAshi([])).toEqual([]);
  });

  it('first HA candle uses (o+c)/2 as open and (o+h+l+c)/4 as close', () => {
    const ha = toHeikinAshi([candle(100, 10, 20, 5, 15)]);
    expect(ha[0]!.o).toBeCloseTo((10 + 15) / 2);
    expect(ha[0]!.c).toBeCloseTo((10 + 20 + 5 + 15) / 4);
  });

  it('preserves t and v from raw candles', () => {
    const raw = candle(1234, 100, 110, 90, 105, 42);
    const [ha] = toHeikinAshi([raw]);
    expect(ha!.t).toBe(1234);
    expect(ha!.v).toBe(42);
  });

  it('HA high = max(rawHigh, haOpen, haClose)', () => {
    const raw = candle(1, 100, 110, 90, 105);
    const ha = toHeikinAshi([raw])[0]!;
    expect(ha.h).toBe(Math.max(110, ha.o, ha.c));
  });

  it('HA low = min(rawLow, haOpen, haClose)', () => {
    const raw = candle(1, 100, 110, 90, 105);
    const ha = toHeikinAshi([raw])[0]!;
    expect(ha.l).toBe(Math.min(90, ha.o, ha.c));
  });

  it('second HA candle open = (prevHA.o + prevHA.c)/2', () => {
    const ha = toHeikinAshi([
      candle(1, 10, 20, 5, 15),
      candle(2, 15, 25, 10, 20),
    ]);
    const prev = ha[0]!;
    expect(ha[1]!.o).toBeCloseTo((prev.o + prev.c) / 2);
  });

  it('smooths a simple uptrend into same-direction candles', () => {
    const raw = [
      candle(1, 100, 102, 99, 101),
      candle(2, 101, 103, 100, 102),
      candle(3, 102, 104, 101, 103),
      candle(4, 103, 105, 102, 104),
    ];
    const ha = toHeikinAshi(raw);
    // Each subsequent HA close should be higher than the previous one
    for (let i = 1; i < ha.length; i++) {
      expect(ha[i]!.c).toBeGreaterThan(ha[i - 1]!.c);
    }
  });

  it('advanceHeikinAshi produces the same result as toHeikinAshi step', () => {
    const raw = [candle(1, 10, 20, 5, 15), candle(2, 15, 25, 10, 20)];
    const full = toHeikinAshi(raw);
    const incremental = advanceHeikinAshi(full[0]!, raw[1]!);
    expect(incremental).toEqual(full[1]);
  });

  it('advanceHeikinAshi handles null previous (first candle)', () => {
    const raw = candle(1, 10, 20, 5, 15);
    expect(advanceHeikinAshi(null, raw)).toEqual(toHeikinAshi([raw])[0]);
  });
});

describe('toRenko', () => {
  it('throws on invalid brickSize', () => {
    expect(() => toRenko([], 0)).toThrow();
    expect(() => toRenko([], -5)).toThrow();
    expect(() => toRenko([], Infinity)).toThrow();
  });

  it('returns empty array for empty input', () => {
    expect(toRenko([], 10)).toEqual([]);
  });

  it('emits no bricks when price never moves beyond brickSize', () => {
    const raw = [
      candle(1, 100, 100, 100, 100),
      candle(2, 100, 101, 99, 101),
      candle(3, 101, 102, 100, 100.5),
    ];
    expect(toRenko(raw, 10)).toEqual([]);
  });

  it('emits a single up brick on a 1-brick move', () => {
    const raw = [
      candle(1, 100, 100, 100, 100),
      candle(2, 100, 110, 100, 110),
    ];
    const bricks = toRenko(raw, 10);
    expect(bricks).toHaveLength(1);
    expect(bricks[0]!.o).toBe(100);
    expect(bricks[0]!.c).toBe(110);
    expect(bricks[0]!.h).toBe(110);
    expect(bricks[0]!.l).toBe(100);
  });

  it('emits multiple stacked bricks on a larger move', () => {
    const raw = [
      candle(1, 100, 100, 100, 100),
      candle(2, 100, 130, 100, 130),
    ];
    const bricks = toRenko(raw, 10);
    expect(bricks).toHaveLength(3);
    expect(bricks[0]!.o).toBe(100);
    expect(bricks[0]!.c).toBe(110);
    expect(bricks[1]!.o).toBe(110);
    expect(bricks[1]!.c).toBe(120);
    expect(bricks[2]!.o).toBe(120);
    expect(bricks[2]!.c).toBe(130);
  });

  it('emits down bricks on a down move', () => {
    const raw = [
      candle(1, 100, 100, 100, 100),
      candle(2, 100, 100, 80, 80),
    ];
    const bricks = toRenko(raw, 10);
    expect(bricks).toHaveLength(2);
    expect(bricks[0]!.o).toBe(100);
    expect(bricks[0]!.c).toBe(90);
    expect(bricks[1]!.o).toBe(90);
    expect(bricks[1]!.c).toBe(80);
  });

  it('reversal requires 2 * brickSize movement', () => {
    const raw = [
      candle(1, 100, 100, 100, 100),
      candle(2, 100, 110, 100, 110), // 1 up brick (100 → 110)
      candle(3, 100, 110, 95, 95),   // move is -15 from anchor 110, not enough (needs 20)
    ];
    const bricks = toRenko(raw, 10);
    // Only the initial up brick should exist.
    expect(bricks).toHaveLength(1);
    expect(bricks[0]!.c).toBe(110);
  });

  it('reversal absorbs one brick and emits the remainder in new direction', () => {
    // Move enough for both reversal absorption and a printed brick.
    // After the up brick, anchor=110. A -30 move has abs(delta)=30 →
    // bricks=3, minus 1 absorbed by reversal → 2 down bricks.
    const raw = [
      candle(1, 100, 100, 100, 100),
      candle(2, 100, 110, 100, 110), // up brick to 110
      candle(3, 100, 110, 80, 80),   // -30 move from 110 → reversal absorbs 1, emit 2
    ];
    const bricks = toRenko(raw, 10);
    expect(bricks).toHaveLength(3); // 1 up + 2 down
    expect(bricks[0]!.c).toBe(110);
    expect(bricks[1]!.o).toBe(110);
    expect(bricks[1]!.c).toBe(100);
    expect(bricks[2]!.o).toBe(100);
    expect(bricks[2]!.c).toBe(90);
  });

  it('renko brick closes carry the source candle timestamp', () => {
    const raw = [
      candle(1000, 100, 100, 100, 100),
      candle(2000, 100, 120, 100, 120),
    ];
    const bricks = toRenko(raw, 10);
    for (const b of bricks) expect(b.t).toBe(2000);
  });

  it('renko brick volume is always 0', () => {
    const raw = [
      candle(1, 100, 100, 100, 100),
      candle(2, 100, 120, 100, 120, 500),
    ];
    const bricks = toRenko(raw, 10);
    for (const b of bricks) expect(b.v).toBe(0);
  });
});
