import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { ChartEngine } from '../rendering/ChartEngine';
import { CandleBuffer } from '../data/CandleBuffer';
import { DARK_THEME } from '../constants';
import { installCanvasStub } from '../test-utils/canvasStub';
import { Viewport } from '../interaction/Viewport';
import { computeLayout } from '../utils';
import type { Candle, ChartLayout } from '../types';
import type { Primitive } from '../primitives/Primitive';
import { CompareController, type CompareHost } from './CompareController';
import { ComparePrimitive, CompareScale, normalize as normalizeCompareValue } from './ComparePrimitive';
import type { CompareSeries } from './CompareSeries';

const BASE_T = 1_700_000_000;
const STEP = 60;

function makeCandle(i: number): Candle {
  const c = 100 + Math.sin(i / 3) * 5;
  return { o: c, h: c + 1, l: c - 1, c, v: 10 + i, t: BASE_T + i * STEP };
}

/** Build a populated buffer of `n` candles on the same time grid. */
function makeBuffer(n: number): CandleBuffer {
  const buf = new CandleBuffer();
  for (let i = 0; i < n; i++) buf.append(makeCandle(i));
  return buf;
}

/** A compare series on the main time grid: value at candle `i` is `vals[i]`. */
function seriesFromValues(id: string, color: string, vals: number[]): CompareSeries {
  return {
    id,
    color,
    points: vals.map((value, i) => ({ t: BASE_T + i * STEP, value })),
  };
}

/** Force a synchronous render (installs the time→index resolver on the viewport). */
function forceRender(engine: ChartEngine): void {
  (engine as unknown as { _render: () => void })._render();
}

/** Recording 2D-context stub: captures path ops + property sets. */
interface Op {
  type: 'call' | 'set';
  name: string;
  args?: unknown[];
  value?: unknown;
}
function makeCtx(): CanvasRenderingContext2D & { __ops: Op[]; __props: Record<string, unknown> } {
  const ops: Op[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(
    {},
    {
      get(_t, p: string) {
        if (p === '__ops') return ops;
        if (p === '__props') return props;
        if (p === 'measureText') return (t: string) => ({ width: t.length * 6 });
        if (p in props) return props[p];
        return (...args: unknown[]) => {
          ops.push({ type: 'call', name: p, args });
        };
      },
      set(_t, p: string, v: unknown) {
        props[p] = v;
        ops.push({ type: 'set', name: p, value: v });
        return true;
      },
    },
  );
  return ctx as unknown as CanvasRenderingContext2D & { __ops: Op[]; __props: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Pure normalization
// ---------------------------------------------------------------------------
describe('compare normalization', () => {
  it('percentage maps the base to 0% and scales relatively', () => {
    expect(normalizeCompareValue(100, 100, 'percentage')).toBe(0);
    expect(normalizeCompareValue(110, 100, 'percentage')).toBeCloseTo(10, 9);
    expect(normalizeCompareValue(90, 100, 'percentage')).toBeCloseTo(-10, 9);
    expect(normalizeCompareValue(200, 100, 'percentage')).toBeCloseTo(100, 9);
  });

  it('indexed pins the base to 100', () => {
    expect(normalizeCompareValue(100, 100, 'indexed')).toBe(100);
    expect(normalizeCompareValue(110, 100, 'indexed')).toBeCloseTo(110, 9);
    expect(normalizeCompareValue(50, 100, 'indexed')).toBeCloseTo(50, 9);
  });

  it('price passes the value through unchanged (base ignored)', () => {
    expect(normalizeCompareValue(1234.5, 999, 'price')).toBe(1234.5);
  });

  it('a zero base yields NaN for normalized modes (no divide-by-zero plot)', () => {
    expect(Number.isNaN(normalizeCompareValue(10, 0, 'percentage'))).toBe(true);
    expect(Number.isNaN(normalizeCompareValue(10, 0, 'indexed'))).toBe(true);
    // price never divides, so a 0 base is fine.
    expect(normalizeCompareValue(10, 0, 'price')).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Buffer time → fractional index (the seam behind viewport.timeToX)
// ---------------------------------------------------------------------------
describe('CandleBuffer.fractionalIndexOfTime', () => {
  it('returns the exact index on a candle boundary', () => {
    const buf = makeBuffer(10);
    expect(buf.fractionalIndexOfTime(BASE_T)).toBe(0);
    expect(buf.fractionalIndexOfTime(BASE_T + 5 * STEP)).toBe(5);
    expect(buf.fractionalIndexOfTime(BASE_T + 9 * STEP)).toBe(9);
  });

  it('interpolates a timestamp between two candles', () => {
    const buf = makeBuffer(10);
    // Halfway between candle 3 and 4.
    expect(buf.fractionalIndexOfTime(BASE_T + 3 * STEP + STEP / 2)).toBeCloseTo(3.5, 9);
    // Quarter past candle 6.
    expect(buf.fractionalIndexOfTime(BASE_T + 6 * STEP + STEP / 4)).toBeCloseTo(6.25, 9);
  });

  it('extrapolates before the first and after the last candle', () => {
    const buf = makeBuffer(10);
    expect(buf.fractionalIndexOfTime(BASE_T - STEP / 2)).toBeCloseTo(-0.5, 9);
    expect(buf.fractionalIndexOfTime(BASE_T + 9 * STEP + STEP / 2)).toBeCloseTo(9.5, 9);
  });

  it('returns NaN for an empty buffer, a single candle, or a non-finite input', () => {
    expect(Number.isNaN(new CandleBuffer().fractionalIndexOfTime(BASE_T))).toBe(true);
    expect(Number.isNaN(makeBuffer(1).fractionalIndexOfTime(BASE_T + 1))).toBe(true);
    expect(Number.isNaN(makeBuffer(5).fractionalIndexOfTime(NaN))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// viewport.timeToX
// ---------------------------------------------------------------------------
describe('Viewport.timeToX', () => {
  it('returns NaN until a resolver is installed, then aligns with indexToX', () => {
    const vp = new Viewport();
    vp.setLayout(computeLayout(1000, 500));
    vp.startIndex = 0;
    vp.visibleCount = 50;
    expect(Number.isNaN(vp.timeToX(BASE_T))).toBe(true);

    const buf = makeBuffer(60);
    vp.setTimeToIndexResolver((t) => buf.fractionalIndexOfTime(t));
    // On a candle boundary, timeToX == indexToX of that index.
    expect(vp.timeToX(BASE_T + 5 * STEP)).toBeCloseTo(vp.indexToX(5), 9);
    // Between candles, it sits between the two X's.
    const mid = vp.timeToX(BASE_T + 5 * STEP + STEP / 2);
    expect(mid).toBeGreaterThan(vp.indexToX(5));
    expect(mid).toBeLessThan(vp.indexToX(6));
  });
});

// ---------------------------------------------------------------------------
// CompareScale — shared self-scaling axis
// ---------------------------------------------------------------------------
describe('CompareScale', () => {
  function vpWith(buf: CandleBuffer): Viewport {
    const vp = new Viewport();
    vp.setLayout(computeLayout(1000, 500));
    vp.startIndex = 0;
    vp.visibleCount = 100;
    vp.setTimeToIndexResolver((t) => buf.fractionalIndexOfTime(t));
    return vp;
  }

  it('spans the normalized extrema across all percentage/indexed series', () => {
    const buf = makeBuffer(10);
    const vp = vpWith(buf);
    // Series A: +0%..+20%; Series B: 0%..-30%.
    const a = seriesFromValues('A', '#f00', [100, 110, 120]); // → 0,10,20
    const b = seriesFromValues('B', '#0f0', [100, 85, 70]); // → 0,-15,-30
    const scale = new CompareScale([a, b]);
    scale.ensure(vp);
    expect(scale.min).toBeCloseTo(-30, 6);
    expect(scale.max).toBeCloseTo(20, 6);
  });

  it('excludes price-mode series from the normalized bounds', () => {
    const buf = makeBuffer(10);
    const vp = vpWith(buf);
    const pct = seriesFromValues('A', '#f00', [100, 150]); // → 0,50
    const priced: CompareSeries = { ...seriesFromValues('B', '#0f0', [9999, 1]), normalization: 'price' };
    const scale = new CompareScale([pct, priced]);
    scale.ensure(vp);
    expect(scale.max).toBeCloseTo(50, 6);
    expect(scale.min).toBeCloseTo(0, 6);
  });

  it('pads a flat window instead of collapsing to a zero range', () => {
    const buf = makeBuffer(10);
    const vp = vpWith(buf);
    const flat = seriesFromValues('A', '#f00', [100, 100, 100]); // all → 0%
    const scale = new CompareScale([flat]);
    scale.ensure(vp);
    expect(scale.max).toBeGreaterThan(scale.min);
  });
});

// ---------------------------------------------------------------------------
// ComparePrimitive.draw against a recording context
// ---------------------------------------------------------------------------
describe('ComparePrimitive.draw', () => {
  const LAYOUT: ChartLayout = computeLayout(1000, 500);

  function vpWith(buf: CandleBuffer): Viewport {
    const vp = new Viewport();
    vp.setLayout(LAYOUT);
    vp.startIndex = 0;
    vp.visibleCount = 100;
    vp.priceMin = 90;
    vp.priceMax = 210;
    vp.setTimeToIndexResolver((t) => buf.fractionalIndexOfTime(t));
    return vp;
  }

  it('is a normal-tier primitive with a stable id', () => {
    const p = new ComparePrimitive(seriesFromValues('ETH', '#abc', [1, 2]), new CompareScale([]));
    expect(p.zOrder).toBe('normal');
    expect(p.id).toBe('compare:ETH');
  });

  it('strokes a clipped line for a percentage series', () => {
    const buf = makeBuffer(10);
    const vp = vpWith(buf);
    const series = seriesFromValues('ETH', '#abcdef', [100, 110, 120, 115]);
    const scale = new CompareScale([series]);
    const ctx = makeCtx();
    new ComparePrimitive(series, scale).draw(ctx, LAYOUT, vp, DARK_THEME);

    const names = ctx.__ops.map((o) => `${o.type}:${o.name}`);
    expect(names).toContain('call:save');
    expect(names).toContain('call:clip'); // clipToChart
    expect(names).toContain('call:stroke');
    expect(names).toContain('call:restore');
    expect(ctx.__props.strokeStyle).toBe('#abcdef');
    // One moveTo + several lineTo for a 4-point series.
    expect(ctx.__ops.filter((o) => o.name === 'moveTo').length).toBe(1);
    expect(ctx.__ops.filter((o) => o.name === 'lineTo').length).toBe(3);
  });

  it('breaks the line on a non-finite value (gap)', () => {
    const buf = makeBuffer(10);
    const vp = vpWith(buf);
    const series = seriesFromValues('ETH', '#abc', [100, NaN, 120, 130]);
    const ctx = makeCtx();
    new ComparePrimitive(series, new CompareScale([series])).draw(ctx, LAYOUT, vp, DARK_THEME);
    // Gap after the first point forces a second moveTo when the pen resumes.
    expect(ctx.__ops.filter((o) => o.name === 'moveTo').length).toBe(2);
  });

  it('draws nothing when no point is in the visible window', () => {
    const buf = makeBuffer(10);
    const vp = vpWith(buf);
    // Scroll far past the data; all points map off-screen to the left.
    vp.startIndex = 500;
    const series = seriesFromValues('ETH', '#abc', [100, 110, 120]);
    const ctx = makeCtx();
    new ComparePrimitive(series, new CompareScale([series])).draw(ctx, LAYOUT, vp, DARK_THEME);
    // Bails before save() because the normalization base is unresolved.
    expect(ctx.__ops.some((o) => o.name === 'save')).toBe(false);
  });

  it('positions a priced series on the main price axis (priceToY)', () => {
    const buf = makeBuffer(10);
    const vp = vpWith(buf);
    const series: CompareSeries = {
      ...seriesFromValues('ETH', '#abc', [150, 150]),
      normalization: 'price',
    };
    const ctx = makeCtx();
    new ComparePrimitive(series, new CompareScale([series])).draw(ctx, LAYOUT, vp, DARK_THEME);
    // 150 sits exactly mid-range of [90,210] → vertical center of the chart.
    const expectedY = vp.priceToY(150);
    const move = ctx.__ops.find((o) => o.name === 'moveTo');
    expect((move?.args?.[1] as number)).toBeCloseTo(expectedY, 6);
  });

  it('does not throw against a real ChartEngine after attach + forceRender', () => {
    installCanvasStub();
    const container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({ width: 1000, height: 500, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, toJSON() {} }) as DOMRect;
    document.body.appendChild(container);
    const engine = new ChartEngine(container, DARK_THEME);
    const buf = makeBuffer(40);
    engine.setBuffer(buf);
    engine.viewport.startIndex = 0;
    engine.viewport.visibleCount = 40;

    const series = seriesFromValues(
      'ETH',
      '#3366ff',
      Array.from({ length: 40 }, (_, i) => 100 + Math.cos(i / 4) * 8),
    );
    const scale = new CompareScale([series]);
    engine.attachPrimitive(new ComparePrimitive(series, scale));

    expect(() => forceRender(engine)).not.toThrow();
    engine.destroy();
    container.remove();
  });
});

// ---------------------------------------------------------------------------
// CompareController — attach/detach lifecycle through the host
// ---------------------------------------------------------------------------
describe('CompareController', () => {
  let container: HTMLDivElement;
  let engine: ChartEngine;

  beforeAll(() => installCanvasStub());

  beforeEach(() => {
    container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({ width: 1000, height: 500, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, toJSON() {} }) as DOMRect;
    document.body.appendChild(container);
    engine = new ChartEngine(container, DARK_THEME);
    engine.setBuffer(makeBuffer(30));
    engine.viewport.startIndex = 0;
    engine.viewport.visibleCount = 30;
  });

  afterEach(() => {
    engine.destroy();
    container.remove();
  });

  function hasPrimitive(id: string): boolean {
    return engine.primitives.some((p: Primitive) => p.id === id);
  }

  it('add attaches one ComparePrimitive per series (id compare:<seriesId>)', () => {
    const controller = new CompareController(engine);
    controller.add(seriesFromValues('ETH', '#f00', [100, 110]));
    controller.add(seriesFromValues('SOL', '#0f0', [10, 12]));
    expect(engine.primitives.length).toBe(2);
    expect(hasPrimitive('compare:ETH')).toBe(true);
    expect(hasPrimitive('compare:SOL')).toBe(true);
    expect(controller.list().map((s) => s.id)).toEqual(['ETH', 'SOL']);
  });

  it('adding a duplicate id replaces in place (no double primitive)', () => {
    const controller = new CompareController(engine);
    controller.add({ ...seriesFromValues('ETH', '#f00', [100, 110]), label: 'old' });
    controller.add({ ...seriesFromValues('ETH', '#00f', [100, 120]), label: 'new' });
    expect(engine.primitives.filter((p) => p.id === 'compare:ETH').length).toBe(1);
    expect(controller.list()).toHaveLength(1);
    expect(controller.list()[0]!.label).toBe('new');
    expect(controller.list()[0]!.color).toBe('#00f');
  });

  it('remove detaches the primitive and returns true; false for an unknown id', () => {
    const controller = new CompareController(engine);
    controller.add(seriesFromValues('ETH', '#f00', [100, 110]));
    expect(controller.remove('ETH')).toBe(true);
    expect(hasPrimitive('compare:ETH')).toBe(false);
    expect(controller.list()).toHaveLength(0);
    expect(controller.remove('NOPE')).toBe(false);
  });

  it('list returns a copy (mutating it does not affect the controller)', () => {
    const controller = new CompareController(engine);
    controller.add(seriesFromValues('ETH', '#f00', [100, 110]));
    const snapshot = controller.list();
    snapshot.length = 0;
    expect(controller.list()).toHaveLength(1);
  });

  it('update swaps a series in place and keeps the same primitive', () => {
    const controller = new CompareController(engine);
    controller.add(seriesFromValues('ETH', '#f00', [100, 110]));
    const before = engine.primitives.find((p) => p.id === 'compare:ETH');
    expect(controller.update(seriesFromValues('ETH', '#00f', [100, 200]))).toBe(true);
    const after = engine.primitives.find((p) => p.id === 'compare:ETH');
    expect(after).toBe(before); // same primitive instance reused
    expect(controller.list()[0]!.color).toBe('#00f');
    expect(controller.update(seriesFromValues('NOPE', '#000', [1]))).toBe(false);
  });

  it('clear detaches every primitive and empties the list', () => {
    const controller = new CompareController(engine);
    controller.add(seriesFromValues('ETH', '#f00', [100, 110]));
    controller.add(seriesFromValues('SOL', '#0f0', [10, 12]));
    controller.clear();
    expect(engine.primitives.length).toBe(0);
    expect(controller.list()).toHaveLength(0);
  });

  it('works through a minimal structural CompareHost (not just ChartEngine)', () => {
    const attached: Primitive[] = [];
    const host: CompareHost = {
      attachPrimitive: (p) => {
        attached.push(p);
      },
      detachPrimitive: (id) => {
        const i = attached.findIndex((p) => p.id === id);
        if (i === -1) return false;
        attached.splice(i, 1);
        return true;
      },
    };
    const controller = new CompareController(host);
    controller.add(seriesFromValues('ETH', '#f00', [100, 110]));
    expect(attached.map((p) => p.id)).toEqual(['compare:ETH']);
    controller.remove('ETH');
    expect(attached).toHaveLength(0);
  });
});
