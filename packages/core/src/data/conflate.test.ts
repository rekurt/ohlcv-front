import { describe, it, expect, beforeEach } from 'vitest';
import { conflate, CONFLATE_STEP_THRESHOLD } from './conflate';
import { CandleBuffer } from './CandleBuffer';
import { Viewport } from '../interaction/Viewport';
import { computeLayout } from '../utils';
import type { Candle, ChartLayout } from '../types';

const LAYOUT: ChartLayout = computeLayout(1000, 500);

function makeCandle(i: number): Candle {
  const c = 100 + Math.sin(i / 10) * 20 + i * 0.01;
  const o = 100 + Math.sin((i - 1) / 10) * 20 + (i - 1) * 0.01;
  return { o, h: Math.max(o, c) + 2, l: Math.min(o, c) - 2, c, v: 100 + (i % 13) * 5, t: 1_700_000_000 + i * 60 };
}

function fillBuffer(n: number): CandleBuffer {
  const buf = new CandleBuffer();
  for (let i = 0; i < n; i++) buf.append(makeCandle(i));
  return buf;
}

function sum(a: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]!;
  return s;
}
function maxOf(a: Float64Array): number {
  let m = -Infinity;
  for (let i = 0; i < a.length; i++) if (a[i]! > m) m = a[i]!;
  return m;
}
function minOf(a: Float64Array): number {
  let m = Infinity;
  for (let i = 0; i < a.length; i++) if (a[i]! < m) m = a[i]!;
  return m;
}

describe('conflate', () => {
  let vp: Viewport;

  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
  });

  it('is a no-op (returns the same view) when candles are >=1px apart', () => {
    vp.candleWidth = 8; // candleStep = 10.4 >= 1
    expect(vp.candleStep).toBeGreaterThanOrEqual(CONFLATE_STEP_THRESHOLD);
    const buf = fillBuffer(500);
    vp.startIndex = 0;
    const view = buf.sliceView(0, 500);
    const result = conflate(view, vp, LAYOUT);
    expect(result).toBe(view);
    expect(result.repIndex).toBeUndefined();
  });

  it('returns the empty view unchanged', () => {
    vp.candleWidth = 0.1;
    const view = new CandleBuffer().sliceView(0, 0);
    expect(conflate(view, vp, LAYOUT)).toBe(view);
  });

  it('collapses sub-pixel candles to ~1 bar per pixel column', () => {
    vp.candleWidth = 0.1; // candleStep = 0.13 < 1 → conflation
    vp.startIndex = 0;
    const buf = fillBuffer(5000);
    const view = buf.sliceView(0, 5000);
    const out = conflate(view, vp, LAYOUT);

    expect(out.repIndex).toBeDefined();
    expect(out.length).toBeLessThan(view.length);
    const chartWidth = LAYOUT.chartRight - LAYOUT.chartLeft;
    expect(out.length).toBeLessThanOrEqual(Math.ceil(chartWidth) + 4);
  });

  it('preserves global extrema and totals across the aggregation', () => {
    vp.candleWidth = 0.1;
    vp.startIndex = 0;
    const buf = fillBuffer(5000);
    const view = buf.sliceView(0, 5000);
    const out = conflate(view, vp, LAYOUT);

    // Bucketing partitions candles, so column-wise max/min/sum fold up to
    // the same global values, and first-open / last-close are preserved.
    expect(maxOf(out.high)).toBeCloseTo(maxOf(view.high), 6);
    expect(minOf(out.low)).toBeCloseTo(minOf(view.low), 6);
    expect(sum(out.volume)).toBeCloseTo(sum(view.volume), 3);
    expect(out.open[0]).toBe(view.open[0]);
    expect(out.close[out.length - 1]).toBe(view.close[view.length - 1]);
  });

  it('emits a strictly increasing repIndex starting at the view offset', () => {
    vp.candleWidth = 0.1;
    vp.startIndex = 0;
    const buf = fillBuffer(3000);
    const view = buf.sliceView(0, 3000);
    const out = conflate(view, vp, LAYOUT);
    const rep = out.repIndex!;
    expect(rep[0]).toBe(view.offset);
    for (let i = 1; i < out.length; i++) {
      expect(rep[i]!).toBeGreaterThan(rep[i - 1]!);
    }
  });

  it('matches an explicit per-column aggregation', () => {
    vp.candleWidth = 0.1;
    vp.startIndex = 0;
    const buf = fillBuffer(2000);
    const view = buf.sliceView(0, 2000);
    const out = conflate(view, vp, LAYOUT);

    // Replicate the column grouping the implementation uses.
    type Bucket = { o: number; h: number; l: number; c: number; v: number; rep: number };
    const buckets: Bucket[] = [];
    let curCol = NaN;
    for (let i = 0; i < view.length; i++) {
      const col = Math.floor(vp.indexToX(view.offset + i));
      const o = view.open[i]!, h = view.high[i]!, l = view.low[i]!, c = view.close[i]!, v = view.volume[i]!;
      if (col !== curCol) {
        curCol = col;
        buckets.push({ o, h, l, c, v, rep: view.offset + i });
      } else {
        const b = buckets[buckets.length - 1]!;
        if (h > b.h) b.h = h;
        if (l < b.l) b.l = l;
        b.c = c;
        b.v += v;
      }
    }

    expect(out.length).toBe(buckets.length);
    for (let k = 0; k < buckets.length; k++) {
      expect(out.open[k]).toBeCloseTo(buckets[k]!.o, 9);
      expect(out.high[k]).toBeCloseTo(buckets[k]!.h, 9);
      expect(out.low[k]).toBeCloseTo(buckets[k]!.l, 9);
      expect(out.close[k]).toBeCloseTo(buckets[k]!.c, 9);
      expect(out.volume[k]).toBeCloseTo(buckets[k]!.v, 6);
      expect(out.repIndex![k]).toBe(buckets[k]!.rep);
    }
  });

  it('ignores NaN volumes when summing a bucket', () => {
    vp.candleWidth = 0.1;
    vp.startIndex = 0;
    const buf = fillBuffer(200);
    // Poke a NaN volume into the raw arrays (append rejects non-finite).
    const internals = buf as unknown as { _volume: Float64Array; _head: number };
    internals._volume[internals._head + 5] = NaN;
    const view = buf.sliceView(0, 200);
    const out = conflate(view, vp, LAYOUT);
    for (let k = 0; k < out.length; k++) {
      expect(Number.isFinite(out.volume[k]!)).toBe(true);
    }
  });

  // Г7: a bucket's FIRST candle seeds high/low directly. If that seed is NaN
  // (a gap bar), the merge of the remaining finite candles must still capture
  // the column's real extrema — a NaN seed must not poison the whole bucket.
  // At candleWidth 0.1 indices 0..7 share column 0, so candle 0 is the seed.
  it('a NaN-first bar does not poison the bucket — real finite extrema win (Г7)', () => {
    vp.candleWidth = 0.1; // sub-pixel → conflation; indices 0..7 → one bucket
    vp.startIndex = 0;

    const buf = new CandleBuffer();
    // 8 candles fill bucket 0; the rest spill into later columns. Give bucket 0
    // a known max-high (candle 3) and min-low (candle 5); candle 0 will be NaN.
    for (let i = 0; i < 40; i++) {
      const base = 100 + i;
      const h = i === 3 ? 500 : base + 2;
      const l = i === 5 ? 50 : base - 2;
      buf.append({ o: base, h, l, c: base, v: 10, t: 1_700_000_000 + i * 60 });
    }
    // append() rejects non-finite, so poke the seed (candle 0) high/low to NaN.
    const internals = buf as unknown as { _high: Float64Array; _low: Float64Array; _head: number };
    internals._high[internals._head + 0] = NaN;
    internals._low[internals._head + 0] = NaN;

    const view = buf.sliceView(0, 40);
    const out = conflate(view, vp, LAYOUT);

    // Bucket 0 carries candle 0 (its repIndex). Its extrema must be the finite
    // ones from candles 3 / 5, NOT the NaN seed.
    expect(out.repIndex![0]).toBe(0);
    expect(Number.isFinite(out.high[0]!)).toBe(true);
    expect(Number.isFinite(out.low[0]!)).toBe(true);
    expect(out.high[0]).toBe(500);
    expect(out.low[0]).toBe(50);
  });
});
