import { describe, it, expect } from 'vitest';
import { RangePyramid, type PriceVolumeRange } from './RangePyramid';
import { CandleBuffer } from './CandleBuffer';
import type { Candle } from '../types';

function makeCandle(i: number): Candle {
  const c = 100 + Math.sin(i / 7) * 30 + (i % 11);
  return { o: c - 1, h: c + 3 + (i % 5), l: c - 3 - (i % 4), c, v: 50 + (i % 17) * 3, t: 1_700_000_000 + i * 60 };
}

function fillBuffer(n: number): CandleBuffer {
  const buf = new CandleBuffer();
  for (let i = 0; i < n; i++) buf.append(makeCandle(i));
  return buf;
}

/** Reference NaN-safe range scan over [start, end). */
function brute(buf: CandleBuffer, start: number, end: number): PriceVolumeRange {
  const s = Math.max(0, start);
  const e = Math.min(buf.length, end);
  let minLow = Infinity, maxHigh = -Infinity, maxVol = 0;
  for (let i = s; i < e; i++) {
    const c = buf.candleAt(i)!;
    if (Number.isFinite(c.l) && c.l < minLow) minLow = c.l;
    if (Number.isFinite(c.h) && c.h > maxHigh) maxHigh = c.h;
    if (Number.isFinite(c.v) && c.v > maxVol) maxVol = c.v;
  }
  return { minLow, maxHigh, maxVol };
}

function expectEqualRange(a: PriceVolumeRange, b: PriceVolumeRange): void {
  expect(a.minLow).toBe(b.minLow);
  expect(a.maxHigh).toBe(b.maxHigh);
  expect(a.maxVol).toBe(b.maxVol);
}

describe('RangePyramid', () => {
  it('matches a brute-force scan across many ranges (multi-block buffer)', () => {
    const buf = fillBuffer(2000); // ~8 blocks of 256
    const pyr = new RangePyramid(buf);
    const ranges: [number, number][] = [
      [0, 2000], // whole buffer
      [0, 256], // exactly one block
      [0, 255], // partial, no full block
      [256, 512], // block-aligned
      [100, 900], // unaligned spanning blocks
      [255, 257], // straddles a block boundary
      [1900, 2000], // tail
      [500, 501], // single candle
      [1000, 1000], // empty
    ];
    for (const [s, e] of ranges) {
      expectEqualRange(pyr.rangeOf(s, e), brute(buf, s, e));
    }
  });

  it('clamps out-of-bounds ranges like the brute-force scan', () => {
    const buf = fillBuffer(300);
    const pyr = new RangePyramid(buf);
    expectEqualRange(pyr.rangeOf(-50, 5000), brute(buf, 0, 300));
  });

  it('is NaN-safe (skips corrupt candles, matching brute force)', () => {
    const buf = fillBuffer(600);
    const internals = buf as unknown as { _high: Float64Array; _low: Float64Array; _head: number };
    internals._high[internals._head + 300] = NaN;
    internals._low[internals._head + 300] = NaN;
    const pyr = new RangePyramid(buf);
    expectEqualRange(pyr.rangeOf(0, 600), brute(buf, 0, 600));
    expectEqualRange(pyr.rangeOf(256, 512), brute(buf, 256, 512));
  });

  it('reflects appends (incremental tail rebuild)', () => {
    const buf = fillBuffer(500);
    const pyr = new RangePyramid(buf);
    expectEqualRange(pyr.rangeOf(0, 500), brute(buf, 0, 500));
    // Append a candle with an extreme high/low.
    buf.append({ o: 100, h: 99_999, l: 0.001, c: 100, v: 1_000_000, t: 1_700_000_000 + 500 * 60 });
    const r = pyr.rangeOf(0, buf.length);
    expect(r.maxHigh).toBe(99_999);
    expect(r.minLow).toBe(0.001);
    expect(r.maxVol).toBe(1_000_000);
    expectEqualRange(r, brute(buf, 0, buf.length));
  });

  it('reflects updateLast (last block recomputed)', () => {
    const buf = fillBuffer(500);
    const pyr = new RangePyramid(buf);
    pyr.rangeOf(0, 500); // build
    const last = buf.candleAt(499)!;
    buf.updateLast({ ...last, h: 88_888, l: 0.5 });
    const r = pyr.rangeOf(0, 500);
    expect(r.maxHigh).toBe(88_888);
    expectEqualRange(r, brute(buf, 0, 500));
  });

  it('reflects prepend (full rebuild on head move)', () => {
    const buf = fillBuffer(500);
    const pyr = new RangePyramid(buf);
    pyr.rangeOf(0, 500);
    const older: Candle[] = [];
    for (let i = -10; i < 0; i++) {
      older.push({ o: 100, h: 77_777, l: 100, c: 100, v: 10, t: 1_700_000_000 + i * 60 });
    }
    buf.prepend(older);
    const r = pyr.rangeOf(0, buf.length);
    expect(r.maxHigh).toBe(77_777);
    expectEqualRange(r, brute(buf, 0, buf.length));
  });

  it('reflects evictHead (full rebuild on head move)', () => {
    const buf = fillBuffer(800);
    const pyr = new RangePyramid(buf);
    pyr.rangeOf(0, 800);
    buf.evictHead(300);
    const r = pyr.rangeOf(0, buf.length);
    expectEqualRange(r, brute(buf, 0, buf.length));
  });

  it('returns sentinel range for an empty buffer', () => {
    const pyr = new RangePyramid(new CandleBuffer());
    const r = pyr.rangeOf(0, 0);
    expect(r.minLow).toBe(Infinity);
    expect(r.maxHigh).toBe(-Infinity);
    expect(r.maxVol).toBe(0);
  });

  it('fully rebuilds after a same-length reload that changes middle candles', () => {
    // Build, then reload the SAME buffer with the same length + firstTime but
    // a different time step (so lastTime differs) and a spike in the middle.
    // The tailOnly heuristic must not mistake this for updateLast/append.
    const buf = new CandleBuffer();
    for (let i = 0; i < 600; i++) buf.append({ o: 100, h: 101, l: 99, c: 100, v: 1, t: 1000 + i * 60 });
    const pyr = new RangePyramid(buf);
    expect(pyr.rangeOf(0, 600).maxHigh).toBe(101); // initial build

    buf.clear();
    for (let i = 0; i < 600; i++) {
      const high = i === 300 ? 99_999 : 101; // spike in the middle block
      buf.append({ o: 100, h: high, l: 99, c: 100, v: 1, t: 1000 + i * 120 }); // same first t, diff step → diff lastTime
    }
    const r = pyr.rangeOf(0, 600);
    expect(r.maxHigh).toBe(99_999); // middle spike must be reflected
    expectEqualRange(r, brute(buf, 0, 600));
  });
});
