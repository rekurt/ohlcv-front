import { describe, it, expect, beforeEach } from 'vitest';
import {
  type PriceScaleMode,
  priceToTransformed,
  transformedToPrice,
  LOG_MIN_POSITIVE,
} from './priceScale';
import { Viewport } from './Viewport';
import { CandleBuffer } from '../data/CandleBuffer';
import { computeLayout, niceLogGridValues, niceGridValues, formatPercent } from '../utils';
import type { Candle, ChartLayout } from '../types';

const LAYOUT: ChartLayout = computeLayout(1000, 600);

function makeCandle(i: number, close = 100 + i): Candle {
  return { o: close - 0.5, h: close + 1, l: close - 1, c: close, v: 10 + i, t: 1_700_000_000 + i * 60 };
}

function fillBuffer(n: number, closeFn: (i: number) => number = (i) => 100 + i): CandleBuffer {
  const buf = new CandleBuffer();
  for (let i = 0; i < n; i++) buf.append(makeCandle(i, closeFn(i)));
  return buf;
}

function baseOf(vp: Viewport): number {
  return (vp as unknown as { _priceBase: number })._priceBase;
}

describe('priceScale pure transforms', () => {
  const modes: PriceScaleMode[] = ['linear', 'log', 'percentage', 'indexedTo100'];

  it('round-trips transformedToPrice(priceToTransformed(p)) across decades', () => {
    const base = 100;
    for (const mode of modes) {
      for (const p of [0.5, 1, 9.99, 10, 100, 1000, 42_000]) {
        const t = priceToTransformed(p, mode, base);
        const back = transformedToPrice(t, mode, base);
        expect(back).toBeCloseTo(p, 6);
      }
    }
  });

  it('linear is the identity transform', () => {
    expect(priceToTransformed(123.45, 'linear', 0)).toBe(123.45);
    expect(transformedToPrice(123.45, 'linear', 0)).toBe(123.45);
  });

  it('log produces equal spacing per decade', () => {
    const d1 = priceToTransformed(100, 'log', 0) - priceToTransformed(10, 'log', 0);
    const d2 = priceToTransformed(1000, 'log', 0) - priceToTransformed(100, 'log', 0);
    expect(d1).toBeCloseTo(d2, 9);
    expect(d1).toBeCloseTo(Math.log(10), 9);
  });

  it('log clamps non-positive prices to LOG_MIN_POSITIVE (no NaN/-Infinity)', () => {
    expect(priceToTransformed(0, 'log', 0)).toBe(Math.log(LOG_MIN_POSITIVE));
    expect(priceToTransformed(-5, 'log', 0)).toBe(Math.log(LOG_MIN_POSITIVE));
    expect(Number.isFinite(priceToTransformed(0, 'log', 0))).toBe(true);
  });

  it('percentage expresses fractional change vs base in percent', () => {
    expect(priceToTransformed(110, 'percentage', 100)).toBeCloseTo(10, 9);
    expect(priceToTransformed(90, 'percentage', 100)).toBeCloseTo(-10, 9);
    expect(priceToTransformed(100, 'percentage', 100)).toBeCloseTo(0, 9);
  });

  it('indexedTo100 anchors base at 100', () => {
    expect(priceToTransformed(100, 'indexedTo100', 100)).toBeCloseTo(100, 9);
    expect(priceToTransformed(150, 'indexedTo100', 100)).toBeCloseTo(150, 9);
    expect(priceToTransformed(50, 'indexedTo100', 100)).toBeCloseTo(50, 9);
  });

  it('guards base === 0 without producing NaN', () => {
    expect(Number.isFinite(priceToTransformed(100, 'percentage', 0))).toBe(true);
    expect(Number.isFinite(priceToTransformed(100, 'indexedTo100', 0))).toBe(true);
  });
});

describe('niceLogGridValues', () => {
  it('emits 1/2/5 × 10^n decade ticks across the range', () => {
    expect(niceLogGridValues(1, 1000, 6)).toEqual([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]);
  });

  it('falls back to linear nice values for a tight intra-decade range', () => {
    const ticks = niceLogGridValues(100, 150, 6);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(100);
      expect(t).toBeLessThanOrEqual(150);
    }
    // Fallback path returns the same thing as the linear helper.
    expect(ticks).toEqual(niceGridValues(100, 150, 6));
  });

  it('falls back gracefully when min <= 0', () => {
    expect(() => niceLogGridValues(-10, 100, 6)).not.toThrow();
    expect(niceLogGridValues(0, 100, 6).length).toBeGreaterThan(0);
  });
});

describe('formatPercent', () => {
  it('signs and fixes to two decimals', () => {
    expect(formatPercent(12.3)).toBe('+12.30%');
    expect(formatPercent(-5)).toBe('-5.00%');
    expect(formatPercent(0)).toBe('0.00%');
  });

  it('returns empty string for non-finite input', () => {
    expect(formatPercent(NaN)).toBe('');
    expect(formatPercent(Infinity)).toBe('');
  });
});

describe('Viewport log scale', () => {
  let vp: Viewport;

  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
    vp.setScaleMode('log');
    vp.priceMin = 10;
    vp.priceMax = 1000;
  });

  it('maps priceMin to bottom and priceMax to top', () => {
    expect(vp.priceToY(10)).toBeCloseTo(LAYOUT.chartBottom, 6);
    expect(vp.priceToY(1000)).toBeCloseTo(LAYOUT.chartTop, 6);
  });

  it('places the geometric midpoint (100) at the pixel midpoint', () => {
    const mid = (vp.priceToY(10) + vp.priceToY(1000)) / 2;
    expect(vp.priceToY(100)).toBeCloseTo(mid, 6);
  });

  it('yToPrice is the inverse of priceToY', () => {
    for (const y of [LAYOUT.chartTop, 100, 250, 400, LAYOUT.chartBottom]) {
      expect(vp.priceToY(vp.yToPrice(y))).toBeCloseTo(y, 6);
    }
  });

  it('autoScale skips non-positive lows and keeps priceMin > 0', () => {
    const buf = new CandleBuffer();
    buf.append({ o: 50, h: 60, l: 0, c: 55, v: 1, t: 1 }); // low = 0
    buf.append({ o: 55, h: 120, l: 40, c: 110, v: 1, t: 2 });
    buf.append({ o: 110, h: 130, l: 100, c: 120, v: 1, t: 3 });
    vp.scrollToEnd(buf.length);
    vp.autoScale(buf);
    expect(vp.priceMin).toBeGreaterThan(0);
    expect(vp.priceMax).toBeGreaterThan(vp.priceMin);
  });

  it('scalePriceRangeBy keeps decade evenness (geometric mid stays centered)', () => {
    vp.priceMin = 10;
    vp.priceMax = 1000;
    const anchorY = vp.priceToY(100);
    vp.scalePriceRangeBy(2, anchorY);
    expect(vp.priceMin).toBeGreaterThan(0);
    // The geometric midpoint of the new range still sits at the pixel mid.
    const geoMid = Math.sqrt(vp.priceMin * vp.priceMax);
    const mid = (vp.priceToY(vp.priceMin) + vp.priceToY(vp.priceMax)) / 2;
    expect(vp.priceToY(geoMid)).toBeCloseTo(mid, 4);
  });

  it('gridTicks returns decade ticks with null labels (price-based axis)', () => {
    const ticks = vp.gridTicks(6);
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) expect(t.label).toBeNull();
  });
});

describe('Viewport percentage / indexed scale', () => {
  let vp: Viewport;

  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
  });

  it('anchors percentage base on the first visible close', () => {
    vp.setScaleMode('percentage');
    const buf = fillBuffer(50, (i) => 100 + i); // close[0] = 100
    vp.scrollToEnd(buf.length); // 50 < visibleCount → startIndex 0
    vp.autoScale(buf);
    expect(baseOf(vp)).toBeCloseTo(100, 6);
  });

  it('recomputes the base as the visible window scrolls', () => {
    vp.setScaleMode('percentage');
    const buf = fillBuffer(500, (i) => 100 + i);
    vp.scrollToEnd(buf.length); // startIndex ~ 417
    vp.autoScale(buf);
    const baseAtEnd = baseOf(vp);

    vp.startIndex = 0;
    vp.autoScale(buf);
    const baseAtStart = baseOf(vp);

    expect(baseAtStart).toBeCloseTo(100, 6); // close[0]
    expect(baseAtStart).not.toBeCloseTo(baseAtEnd, 1);
  });

  it('freezes the base while manualPriceScale is on', () => {
    vp.setScaleMode('percentage');
    const buf = fillBuffer(500, (i) => 100 + i);
    vp.scrollToEnd(buf.length);
    vp.autoScale(buf);
    const frozen = baseOf(vp);

    vp.scalePriceRangeBy(2, vp.priceToY(vp.yToPrice(100))); // sets manualPriceScale
    vp.startIndex = 0;
    vp.autoScale(buf); // early-returns in manual mode → base unchanged
    expect(baseOf(vp)).toBe(frozen);
  });

  it('skips a zero first close when choosing the percentage base', () => {
    // A bad tick with close 0 (which validateCandle allows) must not become
    // the base — base = 0 would flatten the whole percentage transform.
    vp.setScaleMode('percentage');
    const buf = new CandleBuffer();
    buf.append({ o: 0, h: 1, l: -1, c: 0, v: 10, t: 1 }); // bad tick: close 0
    buf.append({ o: 100, h: 101, l: 99, c: 105, v: 10, t: 2 }); // first real close
    buf.append({ o: 105, h: 106, l: 104, c: 110, v: 10, t: 3 });
    vp.scrollToEnd(buf.length);
    vp.autoScale(buf);
    expect(baseOf(vp)).toBe(105); // first non-zero close, not 0
  });

  it('percentage gridTicks carry signed-% labels and round-trip y', () => {
    vp.setScaleMode('percentage');
    const buf = fillBuffer(50, (i) => 100 + i);
    vp.scrollToEnd(buf.length);
    vp.autoScale(buf);
    const ticks = vp.gridTicks(6);
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) {
      expect(t.label).toMatch(/^[+-]?\d+\.\d{2}%$/);
      expect(vp.priceToY(t.price)).toBeCloseTo(t.y, 6);
    }
  });

  it('indexed gridTicks carry numeric labels around 100', () => {
    vp.setScaleMode('indexedTo100');
    const buf = fillBuffer(50, (i) => 100 + i);
    vp.scrollToEnd(buf.length);
    vp.autoScale(buf);
    const ticks = vp.gridTicks(6);
    for (const t of ticks) expect(t.label).toMatch(/^\d+\.\d{2}$/);
  });
});

describe('Viewport.formatPriceLabel', () => {
  let vp: Viewport;

  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
    vp.priceMin = 90;
    vp.priceMax = 110;
    // Set a percentage base so the transform has a real anchor.
    const buf = fillBuffer(50, () => 100);
    vp.scrollToEnd(buf.length);
    vp.autoScale(buf);
  });

  it('returns null for linear mode (caller formats)', () => {
    vp.setScaleMode('linear');
    expect(vp.formatPriceLabel(105)).toBeNull();
  });

  it('returns null for log mode (caller formats)', () => {
    vp.setScaleMode('log');
    expect(vp.formatPriceLabel(105)).toBeNull();
  });

  it('returns signed-% string for percentage mode', () => {
    vp.setScaleMode('percentage');
    // Re-autoscale so base is derived in the correct mode (base = 100).
    const buf = fillBuffer(50, () => 100);
    vp.scrollToEnd(buf.length);
    vp.autoScale(buf);
    // base = 100, price = 110 → +10.00%
    expect(vp.formatPriceLabel(110)).toBe('+10.00%');
    expect(vp.formatPriceLabel(90)).toBe('-10.00%');
    expect(vp.formatPriceLabel(100)).toBe('0.00%');
  });

  it('returns decimal string for indexedTo100 mode', () => {
    vp.setScaleMode('indexedTo100');
    const buf = fillBuffer(50, () => 100);
    vp.scrollToEnd(buf.length);
    vp.autoScale(buf);
    expect(vp.formatPriceLabel(110)).toBe('110.00'); // 100 * 110/100 = 110
    expect(vp.formatPriceLabel(50)).toBe('50.00');
  });

  it('is consistent with gridTick labels at the same price', () => {
    vp.setScaleMode('percentage');
    const ticks = vp.gridTicks(6);
    for (const tick of ticks) {
      expect(vp.formatPriceLabel(tick.price)).toBe(tick.label);
    }
  });
});

describe('Viewport.setScaleMode', () => {
  let vp: Viewport;

  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
    vp.priceMin = 100;
    vp.priceMax = 200;
  });

  it('defaults to linear', () => {
    expect(vp.scaleMode).toBe('linear');
  });

  it('switching mode clears manualPriceScale so the new mode auto-fits', () => {
    vp.scalePriceRangeBy(2, vp.priceToY(150));
    expect(vp.manualPriceScale).toBe(true);
    vp.setScaleMode('log');
    expect(vp.manualPriceScale).toBe(false);
    expect(vp.scaleMode).toBe('log');
  });

  it('linear priceToY is unchanged after touching the transform cache', () => {
    // Switch away and back; linear math must still equal the closed form.
    vp.setScaleMode('log');
    vp.setScaleMode('linear');
    const range = vp.priceMax - vp.priceMin;
    const expected = LAYOUT.chartTop + (1 - (150 - vp.priceMin) / range) * (LAYOUT.chartBottom - LAYOUT.chartTop);
    expect(vp.priceToY(150)).toBe(expected);
  });
});
