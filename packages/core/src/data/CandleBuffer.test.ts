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
});
