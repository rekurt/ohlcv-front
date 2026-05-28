import { describe, it, expect } from 'vitest';
import { CandleBuffer } from './CandleBuffer';
import type { Candle } from '../types';

function makeCandle(t: number, price = 100, vol = 1000): Candle {
  return { o: price, h: price + 5, l: price - 5, c: price + 2, v: vol, t };
}

describe('CandleBuffer', () => {
  describe('append', () => {
    it('appends a single candle', () => {
      const buf = new CandleBuffer(4);
      buf.append(makeCandle(1000, 100));
      expect(buf.length).toBe(1);
      expect(buf.lastTime()).toBe(1000);
      expect(buf.lastClose()).toBe(102);
    });

    it('grows capacity when needed', () => {
      const buf = new CandleBuffer(2);
      buf.append(makeCandle(1));
      buf.append(makeCandle(2));
      buf.append(makeCandle(3)); // triggers growth
      expect(buf.length).toBe(3);
      expect(buf.candleAt(2)?.t).toBe(3);
    });

    it('rejects candles with non-finite OHLCVT fields', () => {
      const buf = new CandleBuffer();
      expect(() =>
        buf.append({ o: NaN, h: 1, l: 1, c: 1, v: 1, t: 1 }),
      ).toThrow(/non-finite OHLCVT/);
      expect(() =>
        buf.append({ o: 1, h: 1, l: 1, c: 1, v: 1, t: Infinity }),
      ).toThrow(/non-finite OHLCVT/);
      // The buffer must be unchanged after a rejected append.
      expect(buf.length).toBe(0);
    });

    it('rejects non-finite candles in batch and updateLast too', () => {
      const buf = new CandleBuffer();
      buf.append(makeCandle(1));
      expect(() =>
        buf.updateLast({ o: NaN, h: 1, l: 1, c: 1, v: 1, t: 1 }),
      ).toThrow(/non-finite OHLCVT/);
      expect(() =>
        buf.appendBatch([{ o: 1, h: 1, l: 1, c: 1, v: 1, t: 2 }, { o: 1, h: 1, l: 1, c: 1, v: NaN, t: 3 }]),
      ).toThrow(/non-finite OHLCVT/);
    });

    it('appendBatch is atomic — a thrown validation leaves length unchanged', () => {
      const buf = new CandleBuffer();
      buf.append(makeCandle(100, 100));
      const lengthBefore = buf.length;
      // Mixed payload: two valid candles followed by one NaN-poisoned one.
      // Previous implementation would have written the first two before
      // throwing, leaving the buffer in a partially-mutated state.
      expect(() =>
        buf.appendBatch([
          { o: 1, h: 1, l: 1, c: 1, v: 1, t: 200 },
          { o: 2, h: 2, l: 2, c: 2, v: 2, t: 300 },
          { o: NaN, h: 1, l: 1, c: 1, v: 1, t: 400 },
        ]),
      ).toThrow(/non-finite OHLCVT/);
      expect(buf.length).toBe(lengthBefore);
      expect(buf.lastTime()).toBe(100);
    });

    it('prepend is atomic — a thrown validation leaves length unchanged', () => {
      const buf = new CandleBuffer();
      buf.append(makeCandle(1000));
      const lengthBefore = buf.length;
      expect(() =>
        buf.prepend([
          { o: 1, h: 1, l: 1, c: 1, v: 1, t: 100 },
          { o: 1, h: 1, l: 1, c: NaN, v: 1, t: 200 },
          { o: 1, h: 1, l: 1, c: 1, v: 1, t: 300 },
        ]),
      ).toThrow(/non-finite OHLCVT/);
      expect(buf.length).toBe(lengthBefore);
      expect(buf.firstTime()).toBe(1000);
    });
  });

  describe('appendBatch', () => {
    it('appends multiple candles at once', () => {
      const buf = new CandleBuffer(4);
      const candles = [makeCandle(1), makeCandle(2), makeCandle(3)];
      buf.appendBatch(candles);
      expect(buf.length).toBe(3);
      expect(buf.firstTime()).toBe(1);
      expect(buf.lastTime()).toBe(3);
    });

    it('pre-grows for large batches', () => {
      const buf = new CandleBuffer(2);
      const candles = Array.from({ length: 100 }, (_, i) => makeCandle(i));
      buf.appendBatch(candles);
      expect(buf.length).toBe(100);
    });
  });

  describe('updateLast', () => {
    it('updates the last candle in-place', () => {
      const buf = new CandleBuffer();
      buf.append(makeCandle(1, 100));
      buf.updateLast(makeCandle(1, 200));
      expect(buf.candleAt(0)?.o).toBe(200);
      expect(buf.length).toBe(1);
    });

    it('does nothing on empty buffer', () => {
      const buf = new CandleBuffer();
      buf.updateLast(makeCandle(1));
      expect(buf.length).toBe(0);
    });
  });

  describe('prepend', () => {
    it('prepends candles before existing data', () => {
      const buf = new CandleBuffer(4);
      buf.appendBatch([makeCandle(10), makeCandle(20)]);
      buf.prepend([makeCandle(1), makeCandle(5)]);
      expect(buf.length).toBe(4);
      expect(buf.firstTime()).toBe(1);
      expect(buf.candleAt(1)?.t).toBe(5);
      expect(buf.candleAt(2)?.t).toBe(10);
      expect(buf.lastTime()).toBe(20);
    });

    it('handles prepend to empty buffer', () => {
      const buf = new CandleBuffer();
      buf.prepend([makeCandle(1), makeCandle(2)]);
      expect(buf.length).toBe(2);
      expect(buf.firstTime()).toBe(1);
    });

    it('sorts unsorted input before prepending', () => {
      const buf = new CandleBuffer();
      buf.append(makeCandle(100));
      // Intentionally unsorted input — must end up sorted internally.
      buf.prepend([makeCandle(50), makeCandle(10), makeCandle(30)]);
      expect(buf.length).toBe(4);
      expect(buf.candleAt(0)?.t).toBe(10);
      expect(buf.candleAt(1)?.t).toBe(30);
      expect(buf.candleAt(2)?.t).toBe(50);
      expect(buf.candleAt(3)?.t).toBe(100);
      // Binary search must still work across the sorted result.
      expect(buf.findIndexByTime(30)).toBe(1);
      expect(buf.findIndexByTime(100)).toBe(3);
    });

    it('uses O(1) leftPad shift after the first growth (no realloc on repeat)', () => {
      const buf = new CandleBuffer();
      // First page: triggers slow-path allocation; reserves leftPad.
      const page = (start: number) =>
        Array.from({ length: 100 }, (_, i) => makeCandle(start + i, 100 + i));
      buf.appendBatch(page(1000));
      buf.prepend(page(900));

      // Grab the underlying TypedArray identities. Subsequent
      // prepends within leftPad capacity must NOT reallocate.
      const internals = buf as unknown as {
        _open: Float64Array;
        _head: number;
        _length: number;
      };
      const openId = internals._open;
      const headBefore = internals._head;

      buf.prepend(page(800));
      // Same array reference — proves no allocation happened.
      expect(internals._open).toBe(openId);
      // _head decreased by 100 (one full page worth).
      expect(internals._head).toBe(headBefore - 100);
      expect(buf.length).toBe(300);
      expect(buf.firstTime()).toBe(800);
      expect(buf.lastTime()).toBe(1099);
    });

    it('candleAt + findIndexByTime stay correct across mixed append/prepend cycles', () => {
      const buf = new CandleBuffer();
      const make = (t: number) => makeCandle(t);
      buf.appendBatch([make(100), make(101), make(102), make(103)]);
      buf.prepend([make(98), make(99)]);
      buf.append(make(104));
      buf.prepend([make(95), make(96), make(97)]);
      buf.append(make(105));

      expect(buf.length).toBe(11);
      expect(buf.firstTime()).toBe(95);
      expect(buf.lastTime()).toBe(105);
      expect(buf.candleAt(0)?.t).toBe(95);
      expect(buf.candleAt(10)?.t).toBe(105);
      expect(buf.findIndexByTime(100)).toBe(5);
      expect(buf.findIndexByTime(95)).toBe(0);
      expect(buf.findIndexByTime(105)).toBe(10);
    });
  });

  describe('appendBatch monotonicity', () => {
    it('sorts unsorted input before appending', () => {
      const buf = new CandleBuffer();
      buf.appendBatch([makeCandle(30), makeCandle(10), makeCandle(20)]);
      expect(buf.length).toBe(3);
      expect(buf.firstTime()).toBe(10);
      expect(buf.lastTime()).toBe(30);
      expect(buf.findIndexByTime(20)).toBe(1);
    });

    it('drops candles with time <= current last time', () => {
      const buf = new CandleBuffer();
      buf.append(makeCandle(100));
      // 50 and 100 should both be dropped; 150 should land.
      buf.appendBatch([makeCandle(50), makeCandle(100), makeCandle(150)]);
      expect(buf.length).toBe(2);
      expect(buf.firstTime()).toBe(100);
      expect(buf.lastTime()).toBe(150);
    });

    it('no-ops on empty input', () => {
      const buf = new CandleBuffer();
      buf.append(makeCandle(1));
      buf.appendBatch([]);
      expect(buf.length).toBe(1);
    });
  });

  describe('findIndexByTime', () => {
    it('finds exact timestamp via binary search', () => {
      const buf = new CandleBuffer();
      buf.appendBatch([makeCandle(10), makeCandle(20), makeCandle(30), makeCandle(40)]);
      expect(buf.findIndexByTime(20)).toBe(1);
      expect(buf.findIndexByTime(40)).toBe(3);
    });

    it('returns -1 for missing timestamp', () => {
      const buf = new CandleBuffer();
      buf.appendBatch([makeCandle(10), makeCandle(20), makeCandle(30)]);
      expect(buf.findIndexByTime(25)).toBe(-1);
    });

    it('returns -1 for empty buffer', () => {
      const buf = new CandleBuffer();
      expect(buf.findIndexByTime(10)).toBe(-1);
    });
  });

  describe('sliceView', () => {
    it('returns zero-copy subarray view', () => {
      const buf = new CandleBuffer();
      buf.appendBatch([makeCandle(1, 100), makeCandle(2, 200), makeCandle(3, 300)]);

      const view = buf.sliceView(1, 3);
      expect(view.length).toBe(2);
      expect(view.offset).toBe(1);
      expect(view.open[0]).toBe(200);
      expect(view.open[1]).toBe(300);
      expect(view.time[0]).toBe(2);
      expect(view.time[1]).toBe(3);
    });

    it('clamps out-of-bounds indices', () => {
      const buf = new CandleBuffer();
      buf.appendBatch([makeCandle(1), makeCandle(2)]);

      const view = buf.sliceView(-5, 100);
      expect(view.length).toBe(2);
    });

    it('shares memory with buffer (zero-copy)', () => {
      const buf = new CandleBuffer();
      buf.appendBatch([makeCandle(1, 100), makeCandle(2, 200)]);
      const view = buf.sliceView(0, 2);

      // Update through buffer
      buf.updateLast(makeCandle(2, 999));
      // View should reflect the update (shared memory)
      expect(view.open[1]).toBe(999);
    });
  });

  describe('candleAt', () => {
    it('returns candle at index', () => {
      const buf = new CandleBuffer();
      buf.append(makeCandle(42, 150));
      const c = buf.candleAt(0);
      expect(c).not.toBeNull();
      expect(c!.t).toBe(42);
      expect(c!.o).toBe(150);
    });

    it('returns null for out of bounds', () => {
      const buf = new CandleBuffer();
      expect(buf.candleAt(0)).toBeNull();
      expect(buf.candleAt(-1)).toBeNull();
    });
  });

  describe('clear', () => {
    it('resets length to 0', () => {
      const buf = new CandleBuffer();
      buf.appendBatch([makeCandle(1), makeCandle(2), makeCandle(3)]);
      buf.clear();
      expect(buf.length).toBe(0);
      expect(buf.lastTime()).toBe(0);
    });
  });

  describe('evictHead', () => {
    it('drops the oldest candles and shifts logical indices', () => {
      const buf = new CandleBuffer();
      for (let i = 1; i <= 5; i++) buf.append(makeCandle(i, 100 + i));
      const evicted = buf.evictHead(2);
      expect(evicted).toBe(2);
      expect(buf.length).toBe(3);
      // Former index 2 (t=3) is now index 0.
      expect(buf.candleAt(0)?.t).toBe(3);
      expect(buf.firstTime()).toBe(3);
      expect(buf.lastTime()).toBe(5);
    });

    it('clamps to length and bumps version; no-op for count <= 0', () => {
      const buf = new CandleBuffer();
      buf.appendBatch([makeCandle(1), makeCandle(2)]);
      const v = buf.version;
      expect(buf.evictHead(0)).toBe(0);
      expect(buf.version).toBe(v);
      expect(buf.evictHead(99)).toBe(2);
      expect(buf.length).toBe(0);
      expect(buf.version).toBe(v + 1);
    });

    it('keeps capacity bounded under repeated evict+append (compaction)', () => {
      const buf = new CandleBuffer(8);
      // Maintain a rolling window of ~4 candles across many ticks.
      for (let t = 1; t <= 200; t++) {
        buf.append(makeCandle(t, 100 + (t % 7)));
        if (buf.length > 4) buf.evictHead(buf.length - 4);
      }
      expect(buf.length).toBe(4);
      expect(buf.lastTime()).toBe(200);
      expect(buf.candleAt(0)?.t).toBe(197);
      // Reads remain correct and contiguous after many compactions.
      expect(buf.candleAt(3)?.t).toBe(200);
    });
  });
});
