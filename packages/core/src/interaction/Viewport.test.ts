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

describe('Viewport.autoScale replay cap (C1)', () => {
  let vp: Viewport;
  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
    vp.visibleCount = 20;
  });
  const bufLen = (v: Viewport) => (v as unknown as { _bufferLength: number })._bufferLength;

  it('stores the CAPPED length when maxLength is supplied (bounds pan/zoom)', () => {
    vp.autoScale(fillBuffer(100), undefined, 30);
    expect(bufLen(vp)).toBe(30);
  });

  it('stores the real length when no cap is supplied', () => {
    vp.autoScale(fillBuffer(100));
    expect(bufLen(vp)).toBe(100);
  });

  it('clamps a cap larger than the buffer to the real length', () => {
    vp.autoScale(fillBuffer(40), undefined, 999);
    expect(bufLen(vp)).toBe(40);
  });

  it('autoScaleFromView honors the cap on the transform path', () => {
    const buf = fillBuffer(100);
    vp.autoScaleFromView(buf, buf.sliceView(0, 100), undefined, 25);
    expect(bufLen(vp)).toBe(25);
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

  it('goes sub-pixel for very large buffers so the whole history fits', () => {
    // F2: fitAll uses MIN_CANDLE_WIDTH_FIT (not MIN_CANDLE_WIDTH) so a
    // multi-million-bar buffer truly fits on screen; the conflation render
    // path then collapses the sub-pixel candles to one bar per column.
    vp.fitAll(100_000);
    expect(vp.candleWidth).toBeGreaterThan(0);
    expect(vp.candleWidth).toBeLessThan(2); // would have been clamped to 2 before
    expect(vp.visibleCount).toBeGreaterThanOrEqual(100_000); // all candles fit
  });

  it('zoom from a sub-pixel fitAll state never snaps back to MIN_CANDLE_WIDTH', () => {
    // Codex P2: the MIN_CANDLE_WIDTH floor must not apply while sub-pixel —
    // otherwise a single zoom gesture (either direction) discards fitAll.
    // factor > 1 = zoom IN (wider candles); factor < 1 = zoom OUT (narrower).
    const midX = (LAYOUT.chartLeft + LAYOUT.chartRight) / 2;

    // Zoom OUT (factor < 1) from sub-pixel → narrower still, NOT jump to 2px.
    vp.fitAll(100_000);
    const subPixel = vp.candleWidth;
    expect(subPixel).toBeLessThan(2);
    vp.zoom(0.8, midX);
    expect(vp.candleWidth).toBeLessThan(subPixel); // shrank further
    expect(vp.candleWidth).toBeLessThan(2); // still sub-pixel

    // Zoom IN (factor > 1) by a small step from sub-pixel → grows, no snap.
    vp.fitAll(100_000);
    const subPixel2 = vp.candleWidth;
    vp.zoom(1.2, midX);
    expect(vp.candleWidth).toBeGreaterThan(subPixel2);
    expect(vp.candleWidth).toBeLessThan(2); // 1.2 × sub-pixel is still sub-pixel
  });

  it('interactive zoom-out from a normal view still floors at MIN_CANDLE_WIDTH', () => {
    // Preserve the original interactive contract: from a normal (>= MIN)
    // width, repeated zoom-out can't go sub-pixel — only fitAll does.
    const midX = (LAYOUT.chartLeft + LAYOUT.chartRight) / 2;
    vp.candleWidth = 2.2; // just above MIN
    vp.zoom(0.1, midX); // aggressive zoom out
    expect(vp.candleWidth).toBe(2); // MIN_CANDLE_WIDTH
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

  it('autoScale skips NaN / Infinity candles without corrupting the range', () => {
    const buf = new CandleBuffer();
    // One sane candle then a NaN-poisoned one. CandleBuffer.append()
    // now rejects non-finite inputs (review-3-3), so we poke the
    // internal arrays directly to simulate the corruption-in-flight
    // scenario the Viewport's defense-in-depth code still guards.
    buf.append({ o: 100, h: 105, l: 95, c: 102, v: 10, t: 1 });
    buf.append({ o: 99, h: 99, l: 99, c: 99, v: 1, t: 2 });
    buf.append({ o: 110, h: 115, l: 108, c: 112, v: 20, t: 3 });
    const internals = buf as unknown as {
      _open: Float64Array;
      _high: Float64Array;
      _low: Float64Array;
      _close: Float64Array;
    };
    internals._open[1] = NaN;
    internals._high[1] = NaN;
    internals._low[1] = NaN;
    internals._close[1] = NaN;
    vp.scrollToEnd(buf.length);
    vp.autoScale(buf);
    expect(Number.isFinite(vp.priceMin)).toBe(true);
    expect(Number.isFinite(vp.priceMax)).toBe(true);
    expect(vp.priceMin).toBeLessThan(vp.priceMax);
    // The sane candles' range must be included.
    expect(vp.priceMin).toBeLessThan(95);
    expect(vp.priceMax).toBeGreaterThan(115);
  });

  it('autoScale preserves previous range when all visible candles are NaN', () => {
    const buf = new CandleBuffer();
    buf.append({ o: 100, h: 110, l: 90, c: 105, v: 10, t: 1 });
    vp.scrollToEnd(buf.length);
    vp.autoScale(buf);
    const prevMin = vp.priceMin;
    const prevMax = vp.priceMax;

    const buf2 = new CandleBuffer();
    buf2.append({ o: 99, h: 99, l: 99, c: 99, v: 1, t: 2 });
    const i2 = buf2 as unknown as {
      _open: Float64Array;
      _high: Float64Array;
      _low: Float64Array;
      _close: Float64Array;
    };
    i2._open[0] = NaN;
    i2._high[0] = NaN;
    i2._low[0] = NaN;
    i2._close[0] = NaN;
    vp.autoScale(buf2);
    expect(vp.priceMin).toBe(prevMin);
    expect(vp.priceMax).toBe(prevMax);
  });

  it('autoScale on empty visible window sets safe defaults, no divide-by-zero', () => {
    const emptyBuf = new CandleBuffer();
    // Fresh viewport — priceMin === priceMax === 0 by default. autoScale
    // should write a 0..1 range so priceToY has a non-zero denominator.
    vp.autoScale(emptyBuf);
    expect(vp.priceMin).toBe(0);
    expect(vp.priceMax).toBe(1);
    // priceToY must return a finite number in the chart area.
    const y = vp.priceToY(0.5);
    expect(Number.isFinite(y)).toBe(true);
  });
});

describe('Viewport.scalePriceRangeBy (Y-axis drag-to-scale)', () => {
  let vp: Viewport;

  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
    vp.priceMin = 100;
    vp.priceMax = 200;
  });

  it('defaults to autoScale (manualPriceScale = false)', () => {
    expect(vp.manualPriceScale).toBe(false);
  });

  it('factor > 1 expands the range around the anchor', () => {
    const anchorY = vp.priceToY(150); // mid-point
    vp.scalePriceRangeBy(2, anchorY);
    expect(vp.manualPriceScale).toBe(true);
    expect(vp.priceMin).toBeLessThan(100);
    expect(vp.priceMax).toBeGreaterThan(200);
  });

  it('factor < 1 contracts the range around the anchor', () => {
    const anchorY = vp.priceToY(150);
    vp.scalePriceRangeBy(0.5, anchorY);
    expect(vp.priceMin).toBeGreaterThan(100);
    expect(vp.priceMax).toBeLessThan(200);
  });

  it('preserves the price under the anchor', () => {
    const anchorPrice = 150;
    const anchorY = vp.priceToY(anchorPrice);
    vp.scalePriceRangeBy(2, anchorY);
    // The price under the same Y should still be ~150 (the anchor
    // is fixed during a scale).
    const after = vp.yToPrice(anchorY);
    expect(after).toBeCloseTo(anchorPrice, 5);
  });

  it('rejects invalid factors silently', () => {
    const anchorY = vp.priceToY(150);
    vp.scalePriceRangeBy(0, anchorY);
    expect(vp.priceMin).toBe(100);
    expect(vp.priceMax).toBe(200);
    vp.scalePriceRangeBy(-1, anchorY);
    expect(vp.priceMin).toBe(100);
    vp.scalePriceRangeBy(NaN, anchorY);
    expect(vp.priceMin).toBe(100);
  });

  it('clamps extreme factors to [0.05, 20]', () => {
    const anchorY = vp.priceToY(150);
    vp.scalePriceRangeBy(1000, anchorY);
    const range1 = vp.priceMax - vp.priceMin;
    vp.priceMin = 100;
    vp.priceMax = 200;
    vp.scalePriceRangeBy(20, anchorY);
    const range2 = vp.priceMax - vp.priceMin;
    expect(range1).toBeCloseTo(range2, 5);
  });

  it('autoScale skips priceMin/priceMax when manualPriceScale=true', () => {
    vp.scalePriceRangeBy(2, vp.priceToY(150));
    const min = vp.priceMin;
    const max = vp.priceMax;

    const buf = fillBuffer(50);
    vp.scrollToEnd(buf.length);
    vp.autoScale(buf);
    expect(vp.priceMin).toBe(min);
    expect(vp.priceMax).toBe(max);
  });

  it('resetPriceScale re-enables auto-scaling', () => {
    vp.scalePriceRangeBy(2, vp.priceToY(150));
    vp.resetPriceScale();
    expect(vp.manualPriceScale).toBe(false);

    const buf = fillBuffer(50);
    vp.scrollToEnd(buf.length);
    vp.autoScale(buf);
    // After autoScale on a freshly-filled buffer, the range should
    // have changed away from the manually-frozen one.
    expect(vp.priceMin !== 0 || vp.priceMax !== 0).toBe(true);
  });

  it('fitVisible clears manualPriceScale', () => {
    vp.scalePriceRangeBy(2, vp.priceToY(150));
    expect(vp.manualPriceScale).toBe(true);
    vp.fitVisible(50);
    expect(vp.manualPriceScale).toBe(false);
  });
});

describe('Viewport secondary (left) price scale (B2)', () => {
  let vp: Viewport;

  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
    // Right scale: a wide range so left/right projections clearly differ.
    vp.priceMin = 0;
    vp.priceMax = 1000;
  });

  it('defaults the left range to 0..1 before anything binds to it', () => {
    expect(vp.leftPriceMin).toBe(0);
    expect(vp.leftPriceMax).toBe(1);
    expect(vp.leftScaleMode).toBe('linear');
  });

  it('default priceToY(p) equals priceToY(p, "right") (back-compat)', () => {
    for (const p of [0, 123.4, 500, 999.9, 1000]) {
      expect(vp.priceToY(p)).toBe(vp.priceToY(p, 'right'));
    }
  });

  it('default yToPrice(y) equals yToPrice(y, "right") (back-compat)', () => {
    for (const y of [LAYOUT.chartTop, 137, 250.5, LAYOUT.chartBottom]) {
      expect(vp.yToPrice(y)).toBe(vp.yToPrice(y, 'right'));
    }
  });

  it('priceToY(p, "left") uses an independent range (different Y than right)', () => {
    // Left extrema deliberately different from right's 0..1000.
    vp.setLeftRange(0, 100);
    const price = 50;
    const yLeft = vp.priceToY(price, 'left');
    const yRight = vp.priceToY(price, 'right');
    // 50 is mid-range on the left scale but near the bottom on the right
    // scale, so the two Y pixels must differ substantially.
    expect(yLeft).not.toBeCloseTo(yRight, 1);
    // 50 is the midpoint of [0,100] (before padding both bounds symmetrically),
    // so it lands at the vertical center of the chart area.
    expect(yLeft).toBeCloseTo((LAYOUT.chartTop + LAYOUT.chartBottom) / 2, 5);
  });

  it('setLeftRange does not touch the right range', () => {
    const rMin = vp.priceMin;
    const rMax = vp.priceMax;
    vp.setLeftRange(10, 20);
    expect(vp.priceMin).toBe(rMin);
    expect(vp.priceMax).toBe(rMax);
  });

  it('setLeftRange pads the committed range (5% each side, like the right axis)', () => {
    vp.setLeftRange(0, 100);
    // PRICE_PADDING_RATIO = 0.05 → range 100 → pad 5 each side.
    expect(vp.leftPriceMin).toBeCloseTo(-5, 5);
    expect(vp.leftPriceMax).toBeCloseTo(105, 5);
  });

  it('setLeftRange protects a flat (min == max) range from divide-by-zero', () => {
    vp.setLeftRange(42, 42);
    expect(vp.leftPriceMin).toBeLessThan(vp.leftPriceMax);
    const y = vp.priceToY(42, 'left');
    expect(Number.isFinite(y)).toBe(true);
  });

  it('setLeftRange swaps inverted bounds', () => {
    vp.setLeftRange(100, 0);
    expect(vp.leftPriceMin).toBeLessThan(vp.leftPriceMax);
    // Same committed range as the in-order call.
    expect(vp.leftPriceMin).toBeCloseTo(-5, 5);
    expect(vp.leftPriceMax).toBeCloseTo(105, 5);
  });

  it('setLeftRange ignores non-finite inputs (keeps previous range)', () => {
    vp.setLeftRange(0, 100);
    const min = vp.leftPriceMin;
    const max = vp.leftPriceMax;
    vp.setLeftRange(NaN, 50);
    expect(vp.leftPriceMin).toBe(min);
    expect(vp.leftPriceMax).toBe(max);
    vp.setLeftRange(0, Infinity);
    expect(vp.leftPriceMin).toBe(min);
    expect(vp.leftPriceMax).toBe(max);
  });

  it('yToPrice(y, "left") round-trips priceToY(p, "left")', () => {
    vp.setLeftRange(0, 100);
    for (const p of [-5, 0, 37.5, 105]) {
      const y = vp.priceToY(p, 'left');
      expect(vp.yToPrice(y, 'left')).toBeCloseTo(p, 5);
    }
  });
});
