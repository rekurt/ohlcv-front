import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { TimeScaleBehavior } from './TimeScaleBehavior';
import { PriceScaleBehavior } from './PriceScaleBehavior';
import { YieldCurveBehavior } from './YieldCurveBehavior';
import {
  createHorzScaleBehavior,
  listHorzScaleBehaviors,
  registerHorzScaleBehavior,
} from './registry';
import { TimeAxisRenderer } from '../rendering/TimeAxis';
import { ChartEngine } from '../rendering/ChartEngine';
import { Viewport } from '../interaction/Viewport';
import { CandleBuffer } from '../data/CandleBuffer';
import { computeLayout, formatTime, formatPrice } from '../utils';
import { DARK_THEME } from '../constants';
import { installCanvasStub } from '../test-utils/canvasStub';
import type { HorzScaleBehavior } from './HorzScaleBehavior';
import type { Candle, ChartLayout } from '../types';

const LAYOUT: ChartLayout = computeLayout(1000, 500);

function makeCandle(i: number): Candle {
  const base = 100 + i;
  return { o: base, h: base + 1, l: base - 1, c: base, v: 10, t: 1_700_000_000 + i * 3600 };
}

function fillBuffer(n: number): CandleBuffer {
  const buf = new CandleBuffer();
  for (let i = 0; i < n; i++) buf.append(makeCandle(i));
  return buf;
}

function recordingCtx(): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const texts: string[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(
    {},
    {
      get(_t, p: string) {
        if (p === 'fillText') return (label: string) => texts.push(label);
        if (p === 'measureText') return (t: string) => ({ width: t.length * 6 });
        if (p in props) return props[p];
        return () => undefined;
      },
      set(_t, p: string, v: unknown) {
        props[p] = v;
        return true;
      },
    },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

describe('TimeScaleBehavior', () => {
  it('is uniform', () => {
    expect(new TimeScaleBehavior('1H').uniform).toBe(true);
  });

  it('fromLogical returns the candle time, or null out of range', () => {
    const buf = fillBuffer(10);
    const b = new TimeScaleBehavior('1H');
    expect(b.fromLogical(3, buf)).toBe(buf.candleAt(3)!.t);
    expect(b.fromLogical(99, buf)).toBeNull();
    expect(b.fromLogical(-1, buf)).toBeNull();
  });

  it('formatValue matches formatTime at the active resolution', () => {
    const b = new TimeScaleBehavior('1D');
    const t = 1_700_000_000;
    expect(b.formatValue(t)).toBe(formatTime(t, '1D'));
    b.setResolution('1H');
    expect(b.formatValue(t)).toBe(formatTime(t, '1H'));
  });

  it('toLogical round-trips through findIndexByTime', () => {
    const buf = fillBuffer(10);
    const b = new TimeScaleBehavior('1H');
    const t = buf.candleAt(4)!.t;
    expect(b.toLogical(t, buf)).toBe(4);
  });
});

describe('PriceScaleBehavior', () => {
  it('formats the domain value as a price', () => {
    const b = new PriceScaleBehavior();
    expect(b.formatValue(1700000000)).toBe(formatPrice(1700000000));
    expect(b.formatValue(42.5)).toBe(formatPrice(42.5));
  });

  it('accepts a custom formatter', () => {
    const b = new PriceScaleBehavior((v) => `$${v.toFixed(0)}`);
    expect(b.formatValue(123.4)).toBe('$123');
  });

  it('fromLogical returns the strike stored in the t field', () => {
    const buf = fillBuffer(5);
    const b = new PriceScaleBehavior();
    expect(b.fromLogical(2, buf)).toBe(buf.candleAt(2)!.t);
  });
});

describe('horzscale registry', () => {
  it('creates built-in time and price behaviors', () => {
    expect(createHorzScaleBehavior('time')).toBeInstanceOf(TimeScaleBehavior);
    expect(createHorzScaleBehavior('price')).toBeInstanceOf(PriceScaleBehavior);
    expect(createHorzScaleBehavior('nope')).toBeUndefined();
    expect(listHorzScaleBehaviors()).toEqual(expect.arrayContaining(['time', 'price']));
  });

  it('registers a custom behavior factory', () => {
    registerHorzScaleBehavior('test:custom', () => new PriceScaleBehavior());
    expect(createHorzScaleBehavior('test:custom')).toBeInstanceOf(PriceScaleBehavior);
  });
});

describe('TimeAxisRenderer with horizontal-scale behavior', () => {
  function setup() {
    const buf = fillBuffer(60);
    const vp = new Viewport();
    vp.setLayout(LAYOUT);
    vp.scrollToEnd(buf.length);
    vp.autoScale(buf);
    return { buf, vp };
  }

  it('labels via TimeScaleBehavior identically to formatTime', () => {
    const { buf, vp } = setup();
    const { ctx, texts } = recordingCtx();
    new TimeAxisRenderer().render(ctx, LAYOUT, vp, buf, new TimeScaleBehavior('1H'), DARK_THEME);
    expect(texts.length).toBeGreaterThan(0);
    // Every emitted label is a formatTime output (HH:MM for 1H), never a price.
    for (const label of texts) {
      expect(label).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it('labels via PriceScaleBehavior as formatted prices (options-style X)', () => {
    const { buf, vp } = setup();
    const { ctx, texts } = recordingCtx();
    new TimeAxisRenderer().render(ctx, LAYOUT, vp, buf, new PriceScaleBehavior(), DARK_THEME);
    expect(texts.length).toBeGreaterThan(0);
    // t holds big numbers → formatPrice gives a 2-decimal string, not HH:MM.
    for (const label of texts) {
      expect(label).toMatch(/^\d+\.\d{2}$/);
    }
  });
});

describe('YieldCurveBehavior (non-uniform)', () => {
  it('is non-uniform and registered', () => {
    expect(new YieldCurveBehavior().uniform).toBe(false);
    expect(createHorzScaleBehavior('yield-curve')).toBeInstanceOf(YieldCurveBehavior);
  });

  it('domainToCoord01 positions proportionally, unclamped for off-screen values', () => {
    const b = new YieldCurveBehavior();
    expect(b.domainToCoord01(0, 0, 100)).toBe(0);
    expect(b.domainToCoord01(100, 0, 100)).toBe(1);
    expect(b.domainToCoord01(25, 0, 100)).toBeCloseTo(0.25, 9);
    // Off-screen values must escape [0,1] so renderers' edge-culling hides
    // them instead of piling them on chartLeft/chartRight.
    expect(b.domainToCoord01(-10, 0, 100)).toBeCloseTo(-0.1, 9);
    expect(b.domainToCoord01(200, 0, 100)).toBeCloseTo(2, 9);
    expect(b.domainToCoord01(5, 10, 10)).toBe(0); // zero span guard
  });

  it('uses a custom formatter', () => {
    const b = new YieldCurveBehavior((v) => `${v}M`);
    expect(b.formatValue(3)).toBe('3M');
  });
});

describe('Viewport non-uniform coordinate mapping', () => {
  let vp: Viewport;

  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
    vp.startIndex = 0;
    (vp as unknown as { _bufferLength: number })._bufferLength = 5;
  });

  it('indexToX uses the mapping; null restores uniform geometry', () => {
    const W = LAYOUT.chartRight - LAYOUT.chartLeft;
    const coords = [0, 0.1, 0.3, 0.6, 1.0]; // non-uniform spacing
    vp.setCoordinateMapping((i) => coords[i] ?? 0);

    expect(vp.indexToX(0)).toBeCloseTo(LAYOUT.chartLeft, 6);
    expect(vp.indexToX(2)).toBeCloseTo(LAYOUT.chartLeft + 0.3 * W, 6);
    expect(vp.indexToX(4)).toBeCloseTo(LAYOUT.chartLeft + W, 6);

    // Restore uniform — back to the closed-form index spacing.
    vp.setCoordinateMapping(null);
    expect(vp.indexToX(0)).toBeCloseTo(LAYOUT.chartLeft + vp.candleWidth / 2, 6);
  });

  it('xToIndex inverts the mapping to the nearest index', () => {
    const W = LAYOUT.chartRight - LAYOUT.chartLeft;
    const coords = [0, 0.1, 0.3, 0.6, 1.0];
    vp.setCoordinateMapping((i) => coords[i] ?? 0);

    expect(vp.xToIndex(LAYOUT.chartLeft + 0.3 * W)).toBe(2);
    expect(vp.xToIndex(LAYOUT.chartLeft + 0.62 * W)).toBe(3); // nearest to 0.6
    expect(vp.xToIndex(LAYOUT.chartLeft + 0.95 * W)).toBe(4);
    expect(vp.xToIndex(LAYOUT.chartLeft)).toBe(0);
  });

  it('snaps the left edge to the first visible index when scrolled (not off-screen)', () => {
    // startIndex = 2 → indices 0,1 are off-screen. A value-based mapping
    // clamps their coord01 to 0, which used to tie against index 1 at
    // chartLeft and report the wrong (off-screen) candle.
    vp.startIndex = 2;
    vp.setCoordinateMapping((i) => (i < 2 ? 0 : (i - 2) / (4 - 2))); // visible [2,4]
    expect(vp.xToIndex(LAYOUT.chartLeft)).toBe(2);
  });
});

describe('ChartEngine with a non-uniform horizontal scale', () => {
  let container: HTMLDivElement;
  let engine: ChartEngine;

  beforeAll(() => installCanvasStub());

  beforeEach(() => {
    container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({ width: 1000, height: 500, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, toJSON() {} }) as DOMRect;
    document.body.appendChild(container);
    engine = new ChartEngine(container, DARK_THEME);
  });

  afterEach(() => {
    engine.destroy();
    container.remove();
  });

  it('positions bars proportionally to their domain value', () => {
    // Non-uniform tenors in the `t` field: 1, 3, 12, 60 (e.g. months).
    const tenors = [1, 3, 12, 60];
    const buf = new CandleBuffer();
    for (let i = 0; i < tenors.length; i++) {
      const c = 100 + i;
      buf.append({ o: c, h: c + 1, l: c - 1, c, v: 10, t: tenors[i]! });
    }
    engine.setBuffer(buf);
    engine.viewport.startIndex = 0;
    engine.viewport.visibleCount = 4;
    engine.setHorzScale(new YieldCurveBehavior());
    (engine as unknown as { _render: () => void })._render();

    const vp = engine.viewport;
    const W = LAYOUT.chartRight - LAYOUT.chartLeft;
    // from = 1 (idx 0), to = 60 (idx 3). Proportional positions.
    expect(vp.indexToX(0)).toBeCloseTo(LAYOUT.chartLeft, 4);
    expect(vp.indexToX(3)).toBeCloseTo(LAYOUT.chartLeft + W, 4);
    expect(vp.indexToX(1)).toBeCloseTo(LAYOUT.chartLeft + ((3 - 1) / (60 - 1)) * W, 4);
    expect(vp.indexToX(2)).toBeCloseTo(LAYOUT.chartLeft + ((12 - 1) / (60 - 1)) * W, 4);
  });

  it('clears the mapping when switched back to a uniform scale', () => {
    const buf = new CandleBuffer();
    for (let i = 0; i < 10; i++) buf.append({ o: 100, h: 101, l: 99, c: 100, v: 10, t: 1_700_000_000 + i * 60 });
    engine.setBuffer(buf);
    engine.viewport.scrollToEnd(buf.length);
    engine.setHorzScale(new YieldCurveBehavior());
    (engine as unknown as { _render: () => void })._render();
    engine.setHorzScale(new TimeScaleBehavior('1H'));
    (engine as unknown as { _render: () => void })._render();
    // Uniform geometry restored: indexToX matches the closed form.
    const vp = engine.viewport;
    const expected = LAYOUT.chartLeft + (3 - vp.startIndex) * vp.candleStep + vp.candleWidth / 2;
    expect(vp.indexToX(3)).toBeCloseTo(expected, 6);
  });

  it('maps off-screen candles outside the chart so renderers cull them', () => {
    const buf = new CandleBuffer();
    for (let i = 0; i < 10; i++) {
      const c = 100 + i;
      buf.append({ o: c, h: c + 1, l: c - 1, c, v: 10, t: i + 1 }); // tenors 1..10
    }
    engine.setBuffer(buf);
    engine.viewport.startIndex = 2;
    engine.viewport.visibleCount = 3; // visible window ≈ [2, 6)
    engine.setHorzScale(new YieldCurveBehavior());
    (engine as unknown as { _render: () => void })._render();

    const vp = engine.viewport;
    // Candles before/after the visible domain window must land off-screen,
    // not clamped onto chartLeft/chartRight.
    expect(vp.indexToX(0)).toBeLessThan(LAYOUT.chartLeft);
    expect(vp.indexToX(9)).toBeGreaterThan(LAYOUT.chartRight);
  });

  it('preserves `this` when calling a custom behavior domainToCoord01', () => {
    // A class/object behavior whose domainToCoord01 reads instance state must
    // keep its receiver — detaching the method would make `this._k` undefined.
    const behavior: HorzScaleBehavior = {
      uniform: false,
      _k: 0.5,
      toLogical: () => 0,
      fromLogical(logical: number, buffer) {
        const c = buffer.candleAt(Math.round(logical));
        return c ? c.t : null;
      },
      formatValue: (v: number) => String(v),
      domainToCoord01(value: number, from: number, to: number): number {
        return ((value - from) / (to - from)) * (this as { _k: number })._k;
      },
    } as HorzScaleBehavior & { _k: number };

    const buf = new CandleBuffer();
    for (let i = 0; i < 4; i++) {
      const c = 100 + i;
      buf.append({ o: c, h: c + 1, l: c - 1, c, v: 10, t: [10, 20, 30, 40][i]! });
    }
    engine.setBuffer(buf);
    engine.viewport.startIndex = 0;
    engine.viewport.visibleCount = 4;
    engine.setHorzScale(behavior);
    expect(() => (engine as unknown as { _render: () => void })._render()).not.toThrow();

    // from=10, to=40, _k=0.5 → coord01(t=25) = ((25-10)/30)*0.5 = 0.25.
    // Index 1 has t=20 → coord01 = ((20-10)/30)*0.5 = 1/6 → x = left + W/6.
    const vp = engine.viewport;
    const W = LAYOUT.chartRight - LAYOUT.chartLeft;
    expect(vp.indexToX(1)).toBeCloseTo(LAYOUT.chartLeft + (1 / 6) * W, 4);
  });
});
