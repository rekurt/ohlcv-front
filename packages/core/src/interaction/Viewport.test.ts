import { describe, it, expect, beforeEach } from 'vitest';
import { Viewport } from './Viewport';
import { CandleBuffer } from '../data/CandleBuffer';
import { computeLayout } from '../utils';
import type { Candle, ChartLayout } from '../types';

const LAYOUT: ChartLayout = computeLayout(1000, 600);

function makeCandle(i: number, base = 100): Candle {
  return { o: base, h: base + 1, l: base - 1, c: base + 0.5, v: 10, t: 1_700_000_000 + i * 60 };
}

function fillBuffer(n: number): CandleBuffer {
  const buf = new CandleBuffer();
  for (let i = 0; i < n; i++) buf.append(makeCandle(i));
  return buf;
}

describe('Viewport.autoFollow', () => {
  let vp: Viewport;

  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
  });

  it('defaults to true', () => {
    expect(vp.autoFollow).toBe(true);
  });

  it('can be toggled', () => {
    vp.autoFollow = false;
    expect(vp.autoFollow).toBe(false);
    vp.autoFollow = true;
    expect(vp.autoFollow).toBe(true);
  });
});

describe('Viewport.rightPaddingCandles', () => {
  let vp: Viewport;

  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
  });

  it('defaults to 5', () => {
    expect(vp.rightPaddingCandles).toBe(5);
  });

  it('scrollToEnd leaves rightPaddingCandles of empty space past the last candle', () => {
    vp.rightPaddingCandles = 5;
    vp.scrollToEnd(500);
    // startIndex + visibleCount should be 500 + 5 (past the last candle)
    expect(vp.startIndex + vp.visibleCount).toBe(505);
  });

  it('scrollToEnd clamps startIndex to 0 when buffer smaller than visible window', () => {
    vp.rightPaddingCandles = 5;
    vp.scrollToEnd(10); // 10 candles, visibleCount ~115
    expect(vp.startIndex).toBe(0);
  });

  it('rightPaddingCandles=0 pins last candle to the right edge', () => {
    vp.rightPaddingCandles = 0;
    vp.scrollToEnd(500);
    expect(vp.startIndex + vp.visibleCount).toBe(500);
  });
});

describe('Viewport.panPixels', () => {
  let vp: Viewport;

  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
  });

  it('moves startIndex backwards (in time) when pixel delta is positive', () => {
    // Positive deltaX = finger/content moves right = view shifts left = show older candles
    vp.scrollToEnd(500);
    const before = vp.startIndex;
    vp.panPixels(vp.candleStep); // exactly 1 candle worth of pixels
    expect(vp.startIndex).toBeCloseTo(before - 1, 5);
  });

  it('moves startIndex forwards (in time) when pixel delta is negative', () => {
    vp.scrollToEnd(500);
    const before = vp.startIndex;
    vp.panPixels(-vp.candleStep * 3);
    expect(vp.startIndex).toBeCloseTo(before + 3, 5);
  });

  it('clamps to valid range', () => {
    vp.scrollToEnd(500);
    vp.panPixels(100_000); // try to pan way back
    expect(vp.startIndex).toBeGreaterThanOrEqual(-vp.visibleCount / 2);
  });
});

describe('Viewport.fitAll', () => {
  let vp: Viewport;

  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
  });

  it('sets candleWidth so all candles fit in chart area', () => {
    vp.fitAll(100);
    const chartWidth = LAYOUT.chartRight - LAYOUT.chartLeft;
    // Every candle should fit: visibleCount >= 100
    expect(vp.visibleCount).toBeGreaterThanOrEqual(100);
    // candleWidth should be close to chartWidth / 100 (ignoring gap)
    expect(vp.candleWidth).toBeLessThanOrEqual(chartWidth / 100 + 1);
  });

  it('clamps candleWidth to MIN_CANDLE_WIDTH for very large buffers', () => {
    vp.fitAll(100_000);
    expect(vp.candleWidth).toBeGreaterThanOrEqual(2); // MIN_CANDLE_WIDTH
  });

  it('clamps candleWidth to MAX_CANDLE_WIDTH for very small buffers', () => {
    vp.fitAll(3);
    expect(vp.candleWidth).toBeLessThanOrEqual(30); // MAX_CANDLE_WIDTH
  });

  it('sets startIndex to 0 (show from beginning)', () => {
    vp.fitAll(100);
    expect(vp.startIndex).toBe(0);
  });
});

describe('Viewport.fitVisible', () => {
  let vp: Viewport;

  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
  });

  it('resets candleWidth to default', () => {
    vp.candleWidth = 25; // user zoomed in
    vp.fitVisible(500);
    expect(vp.candleWidth).toBe(8); // DEFAULT_CANDLE_WIDTH
  });

  it('scrolls to the end after resetting width', () => {
    vp.candleWidth = 25;
    vp.fitVisible(500);
    // should be at the right edge including padding
    expect(vp.startIndex + vp.visibleCount).toBe(500 + vp.rightPaddingCandles);
  });

  it('sets autoFollow to true', () => {
    vp.autoFollow = false;
    vp.fitVisible(500);
    expect(vp.autoFollow).toBe(true);
  });
});

describe('Viewport.goToLive', () => {
  let vp: Viewport;

  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
    vp.candleWidth = 10;
  });

  it('scrolls to the end without changing candleWidth', () => {
    vp.startIndex = 100;
    vp.autoFollow = false;
    vp.goToLive(500);
    expect(vp.startIndex + vp.visibleCount).toBe(500 + vp.rightPaddingCandles);
    expect(vp.candleWidth).toBe(10);
  });

  it('sets autoFollow to true', () => {
    vp.autoFollow = false;
    vp.goToLive(500);
    expect(vp.autoFollow).toBe(true);
  });
});

describe('Viewport.pan', () => {
  let vp: Viewport;

  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
  });

  it('disables autoFollow when user pans away from the right edge', () => {
    vp.scrollToEnd(500);
    expect(vp.autoFollow).toBe(true);
    vp.pan(-10); // pan into the past
    expect(vp.autoFollow).toBe(false);
  });

  it('re-enables autoFollow when user pans all the way back to the right edge', () => {
    vp.scrollToEnd(500);
    vp.pan(-20); // pan back
    expect(vp.autoFollow).toBe(false);
    vp.pan(20); // pan forward to the edge
    expect(vp.autoFollow).toBe(true);
  });

  it('disables autoFollow when user pans into the future (past the live anchor)', () => {
    vp.scrollToEnd(500);
    expect(vp.autoFollow).toBe(true);
    vp.pan(10); // pan 10 candles beyond the anchor into the empty right padding
    expect(vp.autoFollow).toBe(false);
  });

  it('does not snap viewport back on new ticks when user explores the future zone', () => {
    // Repro for: "когда скроллим в будущее, при обновлении последней свечи
    // график начинает дрыгаться на каждый тик"
    vp.scrollToEnd(500);
    vp.pan(15); // explore future zone
    const startIndexInFuture = vp.startIndex;
    expect(vp.autoFollow).toBe(false);

    // Merger onUpdate would call scrollToEnd only if autoFollow is true.
    // Since we're in the future zone, autoFollow must remain false across
    // any number of live ticks. The test asserts the invariant at the
    // viewport level: autoFollow never flips back to true just because
    // time passes.
    for (let i = 0; i < 10; i++) {
      // Simulate OHLCVChart's onUpdate guard:
      if (vp.autoFollow) vp.scrollToEnd(500);
    }
    expect(vp.autoFollow).toBe(false);
    expect(vp.startIndex).toBe(startIndexInFuture);
  });
});

describe('Viewport integration with autoScale', () => {
  let vp: Viewport;

  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
  });

  it('autoScale works across the visible candles', () => {
    const buf = fillBuffer(100);
    vp.scrollToEnd(100);
    vp.autoScale(buf);
    // priceMin/Max computed from visible candles
    expect(vp.priceMin).toBeLessThan(vp.priceMax);
  });
});
