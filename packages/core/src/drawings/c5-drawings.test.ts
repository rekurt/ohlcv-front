import { describe, it, expect, beforeEach } from 'vitest';
import { ParallelChannel } from './ParallelChannel';
import { RegressionChannel } from './RegressionChannel';
import { Pitchfork } from './Pitchfork';
import { FibFan } from './FibFan';
import { Measure } from './Measure';
import { DrawingLayer } from './DrawingLayer';
import { linearRegression, colorWithAlpha } from './geometry';
import { Viewport } from '../interaction/Viewport';
import type { ChartLayout, ThemeColors } from '../types';

const LAYOUT: ChartLayout = {
  chartLeft: 0,
  chartRight: 800,
  chartTop: 0,
  chartBottom: 400,
  priceAxisWidth: 60,
  leftAxisWidth: 0,
  timeAxisHeight: 24,
  width: 860,
  height: 424,
  volumeTop: 320,
  volumeBottom: 400,
  paneAreaTop: 400,
  paneAreaBottom: 400,
  paneCount: 0,
};

const THEME: ThemeColors = {
  background: '#000',
  bullCandle: '#0f0',
  bearCandle: '#f00',
  bullVolume: '#0a0',
  bearVolume: '#a00',
  grid: '#222',
  axis: '#888',
  text: '#ccc',
  crosshair: '#555',
  priceLine: '#999',
};

// Minimal mock context that records calls so we can assert geometry
// without a real canvas. measureText returns a width proportional to the
// string length so the Measure label box has a finite size.
function mockCtx() {
  const calls: { name: string; args: unknown[] }[] = [];
  const target: Record<string, unknown> = {
    canvas: { width: 800, height: 400 },
  };
  const handler: ProxyHandler<typeof target> = {
    get(t, prop: string) {
      if (prop === 'measureText') {
        return (text: string) => ({ width: text.length * 6 });
      }
      if (prop in t) return t[prop];
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
        return undefined;
      };
    },
    set(t, prop: string, value: unknown) {
      t[prop] = value;
      return true;
    },
  };
  return { ctx: new Proxy(target, handler) as unknown as CanvasRenderingContext2D, calls };
}

function buildViewport(): Viewport {
  const vp = new Viewport();
  vp.setLayout(LAYOUT);
  vp.priceMin = 0;
  vp.priceMax = 200;
  vp.startIndex = 0;
  vp.visibleCount = 50;
  return vp;
}

describe('geometry.linearRegression', () => {
  it('recovers an exact line (zero residual ⇒ zero σ)', () => {
    // y = 2x + 10 sampled at x0=5: samples indexed 0..4.
    const ys = [10, 12, 14, 16, 18];
    const fit = linearRegression(ys, 5);
    expect(fit.slope).toBeCloseTo(2, 10);
    expect(fit.intercept).toBeCloseTo(10, 10);
    expect(fit.sigma).toBeCloseTo(0, 10);
    expect(fit.x0).toBe(5);
  });

  it('produces a non-zero σ for scattered samples', () => {
    const fit = linearRegression([10, 13, 12, 17, 16], 0);
    expect(fit.sigma).toBeGreaterThan(0);
    expect(Number.isFinite(fit.slope)).toBe(true);
  });

  it('degrades gracefully with <2 finite samples', () => {
    expect(linearRegression([], 3)).toMatchObject({ slope: 0, sigma: 0, x0: 3 });
    expect(linearRegression([NaN, NaN], 0)).toMatchObject({ slope: 0, sigma: 0 });
    expect(linearRegression([42], 0)).toMatchObject({ slope: 0, sigma: 0 });
  });
});

describe('geometry.colorWithAlpha', () => {
  it('expands #rrggbb and #rgb to rgba', () => {
    expect(colorWithAlpha('#ff8800', 0.5)).toBe('rgba(255, 136, 0, 0.5)');
    expect(colorWithAlpha('#f80', 0.25)).toBe('rgba(255, 136, 0, 0.25)');
  });
  it('rewrites rgb()/rgba() alpha', () => {
    expect(colorWithAlpha('rgb(1, 2, 3)', 0.4)).toBe('rgba(1, 2, 3, 0.4)');
    expect(colorWithAlpha('rgba(1, 2, 3, 0.9)', 0.1)).toBe('rgba(1, 2, 3, 0.1)');
  });
  it('passes through unknown formats unchanged', () => {
    expect(colorWithAlpha('hotpink', 0.5)).toBe('hotpink');
  });
});

describe('ParallelChannel', () => {
  let vp: Viewport;
  beforeEach(() => {
    vp = buildViewport();
  });

  it('requires 3 points and kind "parallelchannel"', () => {
    const c = new ParallelChannel();
    expect(c.requiredPoints).toBe(3);
    expect(c.kind).toBe('parallelchannel');
  });

  it('renders nothing before completion', () => {
    const { ctx, calls } = mockCtx();
    const c = new ParallelChannel();
    c.addPoint({ index: 0, price: 50 });
    c.addPoint({ index: 10, price: 80 });
    c.render(ctx, LAYOUT, vp, THEME);
    expect(calls.length).toBe(0);
  });

  it('renders fill + two boundary strokes once complete', () => {
    const { ctx, calls } = mockCtx();
    const c = new ParallelChannel();
    c.color = '#00ff00';
    c.addPoint({ index: 0, price: 50 });
    c.addPoint({ index: 20, price: 90 });
    c.addPoint({ index: 10, price: 120 });
    c.render(ctx, LAYOUT, vp, THEME);
    expect(calls.some((c2) => c2.name === 'fill')).toBe(true);
    expect(calls.filter((c2) => c2.name === 'stroke').length).toBeGreaterThanOrEqual(2);
  });

  it('skips a vertical (degenerate) base line', () => {
    const { ctx, calls } = mockCtx();
    const c = new ParallelChannel();
    c.addPoint({ index: 5, price: 50 });
    c.addPoint({ index: 5, price: 90 });
    c.addPoint({ index: 5, price: 120 });
    c.render(ctx, LAYOUT, vp, THEME);
    expect(calls.some((c2) => c2.name === 'stroke')).toBe(false);
  });

  it('hitTest matches on a boundary and misses far away', () => {
    const c = new ParallelChannel();
    c.addPoint({ index: 0, price: 100 });
    c.addPoint({ index: 20, price: 100 });
    c.addPoint({ index: 10, price: 150 });
    // Base boundary is the flat price-100 line. y at price 100:
    const yBase = vp.priceToY(100);
    const xMid = vp.indexToX(10);
    expect(c.hitTest(xMid, yBase, LAYOUT, vp)).toBe(true);
    // Far below both boundaries.
    expect(c.hitTest(xMid, vp.priceToY(10), LAYOUT, vp)).toBe(false);
  });

  it('round-trips through DrawingLayer snapshots', () => {
    const layer = new DrawingLayer();
    const c = new ParallelChannel();
    c.addPoint({ index: 0, price: 50 });
    c.addPoint({ index: 20, price: 90 });
    c.addPoint({ index: 10, price: 120 });
    c.color = '#abcdef';
    layer.add(c);
    const snap = layer.toSnapshot();
    expect(snap[0]!.kind).toBe('parallelchannel');
    const restored = DrawingLayer.fromSnapshot(snap);
    expect(restored.drawings[0]!.kind).toBe('parallelchannel');
    expect(restored.drawings[0]!.points).toHaveLength(3);
    expect(restored.drawings[0]!.color).toBe('#abcdef');
  });

  it('updateLastPoint moves the offset anchor', () => {
    const c = new ParallelChannel();
    c.addPoint({ index: 0, price: 50 });
    c.addPoint({ index: 20, price: 90 });
    c.addPoint({ index: 10, price: 120 });
    c.updateLastPoint({ index: 10, price: 130 });
    expect(c.points[2]).toEqual({ index: 10, price: 130 });
  });
});

describe('RegressionChannel', () => {
  let vp: Viewport;
  beforeEach(() => {
    vp = buildViewport();
  });

  it('requires 2 points, kind "regression", K=2', () => {
    const r = new RegressionChannel();
    expect(r.requiredPoints).toBe(2);
    expect(r.kind).toBe('regression');
    expect(RegressionChannel.K).toBe(2);
  });

  it('pulls closes from its sampler on first render and caches them', () => {
    let sampleCalls = 0;
    const closes = [100, 102, 104, 103, 108, 110]; // indices 0..5
    const r = new RegressionChannel();
    r.setSampler((start, end) => {
      sampleCalls++;
      expect(start).toBe(0);
      expect(end).toBe(5);
      return closes.slice();
    });
    r.addPoint({ index: 0, price: 100 });
    r.addPoint({ index: 5, price: 110 });
    expect(r.hasSamples).toBe(false);
    const { ctx } = mockCtx();
    r.render(ctx, LAYOUT, vp, THEME);
    expect(r.hasSamples).toBe(true);
    expect(sampleCalls).toBe(1);
    // Second render must reuse the cache (no extra sampler call).
    r.render(ctx, LAYOUT, vp, THEME);
    expect(sampleCalls).toBe(1);
  });

  it('draws a filled band when σ > 0 (scattered closes)', () => {
    const r = new RegressionChannel();
    r.setSamples([100, 90, 110, 95, 115, 92], 0);
    r.addPoint({ index: 0, price: 100 });
    r.addPoint({ index: 5, price: 110 });
    const { ctx, calls } = mockCtx();
    r.render(ctx, LAYOUT, vp, THEME);
    expect(calls.some((c) => c.name === 'fill')).toBe(true);
    // Center + 2 band lines ⇒ at least 3 strokes.
    expect(calls.filter((c) => c.name === 'stroke').length).toBeGreaterThanOrEqual(3);
  });

  it('omits the band when σ = 0 (perfectly linear closes)', () => {
    const r = new RegressionChannel();
    r.setSamples([100, 102, 104, 106, 108, 110], 0); // exact line ⇒ σ=0
    r.addPoint({ index: 0, price: 100 });
    r.addPoint({ index: 5, price: 110 });
    const { ctx, calls } = mockCtx();
    r.render(ctx, LAYOUT, vp, THEME);
    expect(calls.some((c) => c.name === 'fill')).toBe(false);
    // Only the center line is stroked.
    expect(calls.filter((c) => c.name === 'stroke').length).toBe(1);
  });

  it('falls back to a bare segment when no samples are available', () => {
    const r = new RegressionChannel();
    r.addPoint({ index: 0, price: 100 });
    r.addPoint({ index: 5, price: 150 });
    const { ctx, calls } = mockCtx();
    expect(() => r.render(ctx, LAYOUT, vp, THEME)).not.toThrow();
    // One center stroke, no fill (zero band).
    expect(calls.filter((c) => c.name === 'stroke').length).toBe(1);
    expect(calls.some((c) => c.name === 'fill')).toBe(false);
  });

  it('hitTest matches near the center line and misses far away', () => {
    const r = new RegressionChannel();
    // Exact line close=2*idx+100 over indices 0..5 ⇒ center coincides.
    r.setSamples([100, 102, 104, 106, 108, 110], 0);
    r.addPoint({ index: 0, price: 100 });
    r.addPoint({ index: 5, price: 110 });
    const xMid = vp.indexToX(2.5);
    const yMid = vp.priceToY(105); // center price at idx 2.5
    expect(r.hitTest(xMid, yMid, LAYOUT, vp)).toBe(true);
    expect(r.hitTest(xMid, vp.priceToY(10), LAYOUT, vp)).toBe(false);
  });

  it('persists samples through snapshot and reproduces the fit on restore', () => {
    const layer = new DrawingLayer();
    const r = new RegressionChannel();
    const samples = [100, 90, 110, 95, 115, 92];
    r.setSamples(samples, 0);
    r.addPoint({ index: 0, price: 100 });
    r.addPoint({ index: 5, price: 110 });
    r.color = '#22aa44';
    layer.add(r);

    const snap = layer.toSnapshot();
    expect(snap[0]!.kind).toBe('regression');
    expect(snap[0]!.data).toEqual(samples);

    const restored = DrawingLayer.fromSnapshot(snap);
    const r2 = restored.drawings[0] as RegressionChannel;
    expect(r2.kind).toBe('regression');
    expect(r2.hasSamples).toBe(true);
    expect(r2.color).toBe('#22aa44');
    // Restored channel renders the same banded geometry without a sampler.
    const { ctx, calls } = mockCtx();
    r2.render(ctx, LAYOUT, vp, THEME);
    expect(calls.some((c) => c.name === 'fill')).toBe(true);
  });

  it('a channel without samples emits no `data` key in its snapshot', () => {
    const r = new RegressionChannel();
    r.addPoint({ index: 0, price: 100 });
    r.addPoint({ index: 5, price: 150 });
    const snap = r.toSnapshot();
    expect('data' in snap).toBe(false);
  });

  it('updateLastPoint moves the span end anchor', () => {
    const r = new RegressionChannel();
    r.addPoint({ index: 0, price: 100 });
    r.addPoint({ index: 5, price: 110 });
    r.updateLastPoint({ index: 8, price: 120 });
    expect(r.points[1]).toEqual({ index: 8, price: 120 });
  });
});

describe('Pitchfork', () => {
  let vp: Viewport;
  beforeEach(() => {
    vp = buildViewport();
  });

  it('requires 3 points and kind "pitchfork"', () => {
    const p = new Pitchfork();
    expect(p.requiredPoints).toBe(3);
    expect(p.kind).toBe('pitchfork');
  });

  it('renders handle, median and two tines once complete', () => {
    const { ctx, calls } = mockCtx();
    const p = new Pitchfork();
    p.addPoint({ index: 0, price: 100 });
    p.addPoint({ index: 10, price: 80 });
    p.addPoint({ index: 10, price: 140 });
    p.render(ctx, LAYOUT, vp, THEME);
    // handle + base + median + 2 tines ⇒ ≥5 strokes, plus the fill.
    expect(calls.filter((c) => c.name === 'stroke').length).toBeGreaterThanOrEqual(5);
    expect(calls.some((c) => c.name === 'fill')).toBe(true);
  });

  it('skips when A coincides with the B–C midpoint (degenerate)', () => {
    const { ctx, calls } = mockCtx();
    const p = new Pitchfork();
    // Midpoint of B,C equals A ⇒ zero direction.
    p.addPoint({ index: 10, price: 100 });
    p.addPoint({ index: 10, price: 80 });
    p.addPoint({ index: 10, price: 120 });
    p.render(ctx, LAYOUT, vp, THEME);
    expect(calls.some((c) => c.name === 'stroke')).toBe(false);
  });

  it('hitTest matches on the handle and misses far away', () => {
    const p = new Pitchfork();
    p.addPoint({ index: 0, price: 100 });
    p.addPoint({ index: 10, price: 80 });
    p.addPoint({ index: 10, price: 140 });
    // Handle origin A.
    expect(p.hitTest(vp.indexToX(0), vp.priceToY(100), LAYOUT, vp)).toBe(true);
    // Corner of the chart, away from any tine.
    expect(p.hitTest(795, 5, LAYOUT, vp)).toBe(false);
  });

  it('round-trips through snapshots and updateLastPoint works', () => {
    const layer = new DrawingLayer();
    const p = new Pitchfork();
    p.addPoint({ index: 0, price: 100 });
    p.addPoint({ index: 10, price: 80 });
    p.addPoint({ index: 10, price: 140 });
    layer.add(p);
    const restored = DrawingLayer.fromSnapshot(layer.toSnapshot());
    expect(restored.drawings[0]!.kind).toBe('pitchfork');
    expect(restored.drawings[0]!.points).toHaveLength(3);
    p.updateLastPoint({ index: 12, price: 150 });
    expect(p.points[2]).toEqual({ index: 12, price: 150 });
  });
});

describe('FibFan', () => {
  let vp: Viewport;
  beforeEach(() => {
    vp = buildViewport();
  });

  it('requires 2 points, kind "fibfan", canonical levels', () => {
    const f = new FibFan();
    expect(f.requiredPoints).toBe(2);
    expect(f.kind).toBe('fibfan');
    expect(FibFan.LEVELS).toEqual([0.382, 0.5, 0.618]);
  });

  it('draws the base line plus one ray per level', () => {
    const { ctx, calls } = mockCtx();
    const f = new FibFan();
    f.addPoint({ index: 0, price: 50 });
    f.addPoint({ index: 20, price: 150 });
    f.render(ctx, LAYOUT, vp, THEME);
    // base + 3 rays ⇒ 4 strokes.
    expect(calls.filter((c) => c.name === 'stroke').length).toBe(4);
  });

  it('skips a degenerate (coincident) fan', () => {
    const { ctx, calls } = mockCtx();
    const f = new FibFan();
    f.addPoint({ index: 5, price: 100 });
    f.addPoint({ index: 5, price: 100 });
    f.render(ctx, LAYOUT, vp, THEME);
    expect(calls.some((c) => c.name === 'stroke')).toBe(false);
  });

  it('hitTest matches on the base line and misses far away', () => {
    const f = new FibFan();
    f.addPoint({ index: 0, price: 50 });
    f.addPoint({ index: 20, price: 150 });
    // Anchor A is on every ray and the base line.
    expect(f.hitTest(vp.indexToX(0), vp.priceToY(50), LAYOUT, vp)).toBe(true);
    // A point well outside the fan spread.
    expect(f.hitTest(vp.indexToX(0), vp.priceToY(200), LAYOUT, vp)).toBe(false);
  });

  it('round-trips through snapshots and updateLastPoint works', () => {
    const layer = new DrawingLayer();
    const f = new FibFan();
    f.addPoint({ index: 0, price: 50 });
    f.addPoint({ index: 20, price: 150 });
    f.color = '#778899';
    layer.add(f);
    const restored = DrawingLayer.fromSnapshot(layer.toSnapshot());
    expect(restored.drawings[0]!.kind).toBe('fibfan');
    expect(restored.drawings[0]!.color).toBe('#778899');
    f.updateLastPoint({ index: 25, price: 160 });
    expect(f.points[1]).toEqual({ index: 25, price: 160 });
  });
});

describe('Measure', () => {
  let vp: Viewport;
  beforeEach(() => {
    vp = buildViewport();
  });

  it('requires 2 points and kind "measure"', () => {
    const m = new Measure();
    expect(m.requiredPoints).toBe(2);
    expect(m.kind).toBe('measure');
  });

  it('renders box + readout (two text lines) once complete', () => {
    const { ctx, calls } = mockCtx();
    const m = new Measure();
    m.addPoint({ index: 0, price: 100 });
    m.addPoint({ index: 10, price: 150 });
    m.render(ctx, LAYOUT, vp, THEME);
    expect(calls.some((c) => c.name === 'fillRect')).toBe(true);
    expect(calls.some((c) => c.name === 'strokeRect')).toBe(true);
    const texts = calls.filter((c) => c.name === 'fillText');
    expect(texts.length).toBe(2);
    // First line shows the +50.0000 delta and +50.00% (price 100 → 150).
    const line1 = String(texts[0]!.args[0]);
    expect(line1).toContain('%');
    // Second line shows the bar span (|10 - 0| = 10).
    expect(String(texts[1]!.args[0])).toContain('10');
  });

  it('renders nothing before completion', () => {
    const { ctx, calls } = mockCtx();
    const m = new Measure();
    m.addPoint({ index: 0, price: 100 });
    m.render(ctx, LAYOUT, vp, THEME);
    expect(calls.length).toBe(0);
  });

  it('hitTest matches inside the box and misses outside', () => {
    const m = new Measure();
    m.addPoint({ index: 0, price: 100 });
    m.addPoint({ index: 10, price: 150 });
    const xIn = (vp.indexToX(0) + vp.indexToX(10)) / 2;
    const yIn = (vp.priceToY(100) + vp.priceToY(150)) / 2;
    expect(m.hitTest(xIn, yIn, LAYOUT, vp)).toBe(true);
    // Far to the right of the box.
    expect(m.hitTest(vp.indexToX(40), yIn, LAYOUT, vp)).toBe(false);
  });

  it('round-trips through snapshots and updateLastPoint works', () => {
    const layer = new DrawingLayer();
    const m = new Measure();
    m.addPoint({ index: 0, price: 100 });
    m.addPoint({ index: 10, price: 150 });
    layer.add(m);
    const restored = DrawingLayer.fromSnapshot(layer.toSnapshot());
    expect(restored.drawings[0]!.kind).toBe('measure');
    expect(restored.drawings[0]!.points).toHaveLength(2);
    m.updateLastPoint({ index: 12, price: 160 });
    expect(m.points[1]).toEqual({ index: 12, price: 160 });
  });
});
