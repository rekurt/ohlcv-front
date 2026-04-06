import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CandleMerger } from './CandleMerger';
import { CandleBuffer } from './CandleBuffer';
import type { Candle } from '../types';

function makeCandle(t: number, o = 100, h = 105, l = 95, c = 102, v = 1000): Candle {
  return { o, h, l, c, v, t };
}

describe('CandleMerger', () => {
  let buffer: CandleBuffer;
  let merger: CandleMerger;

  beforeEach(() => {
    buffer = new CandleBuffer();
    merger = new CandleMerger(buffer);
    // Mock RAF
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 0; });
  });

  describe('mergeRealtime', () => {
    it('appends new candles', () => {
      buffer.append(makeCandle(100));
      merger.mergeRealtime([makeCandle(200)]);
      expect(buffer.length).toBe(2);
      expect(buffer.lastTime()).toBe(200);
    });

    it('updates in-place when timestamp matches last', () => {
      buffer.append(makeCandle(100, 50));
      merger.mergeRealtime([makeCandle(100, 75)]);
      expect(buffer.length).toBe(1);
      expect(buffer.candleAt(0)?.o).toBe(75);
    });

    it('ignores candles older than last', () => {
      buffer.appendBatch([makeCandle(100), makeCandle(200)]);
      merger.mergeRealtime([makeCandle(50)]);
      expect(buffer.length).toBe(2);
    });

    it('handles mixed batch (update + append)', () => {
      buffer.append(makeCandle(100));
      merger.mergeRealtime([
        makeCandle(100, 80), // update
        makeCandle(200, 90), // append
      ]);
      expect(buffer.length).toBe(2);
      expect(buffer.candleAt(0)?.o).toBe(80);
      expect(buffer.candleAt(1)?.o).toBe(90);
    });

    it('appends to empty buffer', () => {
      merger.mergeRealtime([makeCandle(100)]);
      expect(buffer.length).toBe(1);
    });
  });

  describe('loadHistory', () => {
    it('loads into empty buffer', () => {
      merger.loadHistory([makeCandle(10), makeCandle(20), makeCandle(30)]);
      expect(buffer.length).toBe(3);
      expect(buffer.firstTime()).toBe(10);
      expect(buffer.lastTime()).toBe(30);
    });

    it('prepends older candles, filtering overlap', () => {
      buffer.appendBatch([makeCandle(20), makeCandle(30)]);
      merger.loadHistory([makeCandle(5), makeCandle(10), makeCandle(20), makeCandle(25)]);
      // Only t=5 and t=10 should be prepended (< firstTime=20)
      expect(buffer.length).toBe(4);
      expect(buffer.firstTime()).toBe(5);
      expect(buffer.candleAt(1)?.t).toBe(10);
      expect(buffer.candleAt(2)?.t).toBe(20);
    });

    it('skips if all candles overlap', () => {
      buffer.appendBatch([makeCandle(10), makeCandle(20)]);
      merger.loadHistory([makeCandle(10), makeCandle(15), makeCandle(20)]);
      // t=15 is >= firstTime(10), so also filtered out
      expect(buffer.length).toBe(2);
    });

    it('skips empty array', () => {
      buffer.append(makeCandle(10));
      merger.loadHistory([]);
      expect(buffer.length).toBe(1);
    });
  });
});
