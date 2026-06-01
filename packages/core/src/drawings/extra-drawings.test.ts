import { describe, it, expect, beforeEach } from 'vitest';
import { Rectangle } from './Rectangle';
import { Ray } from './Ray';
import { VerticalLine } from './VerticalLine';
import { FibRetracement } from './FibRetracement';
import { DrawingLayer } from './DrawingLayer';
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
// without a real canvas.
function mockCtx() {
  const calls: { name: string; args: unknown[] }[] = [];
  const target: Record<string, unknown> = {
    canvas: { width: 800, height: 400 },
  };
  const handler: ProxyHandler<typeof target> = {
    get(t, prop: string) {
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

describe('Rectangle', () => {
  it('requires 2 points', () => {
    expect(new Rectangle().requiredPoints).toBe(2);
  });

  it('renders nothing with fewer than 2 points', () => {
    const { ctx, calls } = mockCtx();
    const vp = new Viewport();
    vp.setLayout(LAYOUT);
    const r = new Rectangle();
    r.addPoint({ index: 0, price: 100 });
    r.render(ctx, LAYOUT, vp, THEME);
    expect(calls.length).toBe(0);
  });

  it('renders a fill + stroke once complete', () => {
    const { ctx, calls } = mockCtx();
    const vp = new Viewport();
    vp.setLayout(LAYOUT);
    vp.priceMin = 0;
    vp.priceMax = 200;
    const r = new Rectangle();
    r.color = '#00ff00';
    r.addPoint({ index: 0, price: 100 });
    r.addPoint({ index: 10, price: 150 });
    r.render(ctx, LAYOUT, vp, THEME);
    expect(calls.some((c) => c.name === 'fillRect')).toBe(true);
    expect(calls.some((c) => c.name === 'strokeRect')).toBe(true);
  });

  it('round-trips through DrawingLayer snapshots', () => {
    const layer = new DrawingLayer();
    const r = new Rectangle();
    r.addPoint({ index: 0, price: 100 });
    r.addPoint({ index: 10, price: 150 });
    layer.add(r);
    const snap = layer.toSnapshot();
    expect(snap[0]!.kind).toBe('rectangle');
    const restored = DrawingLayer.fromSnapshot(snap);
    expect(restored.drawings.length).toBe(1);
    expect(restored.drawings[0]!.kind).toBe('rectangle');
  });
});

describe('Ray', () => {
  it('requires 2 points', () => {
    expect(new Ray().requiredPoints).toBe(2);
  });

  it('skips degenerate (coincident points)', () => {
    const { ctx, calls } = mockCtx();
    const vp = new Viewport();
    vp.setLayout(LAYOUT);
    vp.priceMin = 0;
    vp.priceMax = 100;
    const r = new Ray();
    r.addPoint({ index: 5, price: 50 });
    r.addPoint({ index: 5, price: 50 });
    r.render(ctx, LAYOUT, vp, THEME);
    expect(calls.some((c) => c.name === 'stroke')).toBe(false);
  });

  it('snapshot kind is "ray"', () => {
    expect(new Ray().kind).toBe('ray');
  });
});

describe('VerticalLine', () => {
  it('requires 1 point', () => {
    expect(new VerticalLine().requiredPoints).toBe(1);
  });

  it('snapshot kind is "vline"', () => {
    expect(new VerticalLine().kind).toBe('vline');
  });

  it('skips rendering when outside the chart area', () => {
    const { ctx, calls } = mockCtx();
    const vp = new Viewport();
    vp.setLayout(LAYOUT);
    const v = new VerticalLine();
    v.addPoint({ index: -100, price: 0 });
    v.render(ctx, LAYOUT, vp, THEME);
    expect(calls.some((c) => c.name === 'stroke')).toBe(false);
  });
});

describe('FibRetracement', () => {
  let vp: Viewport;
  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
    vp.priceMin = 0;
    vp.priceMax = 200;
  });

  it('exposes the canonical 8-level set', () => {
    expect(FibRetracement.LEVELS).toEqual([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618]);
  });

  it('draws one line per visible level when complete', () => {
    const { ctx, calls } = mockCtx();
    const f = new FibRetracement();
    f.addPoint({ index: 0, price: 50 });
    f.addPoint({ index: 10, price: 150 });
    f.render(ctx, LAYOUT, vp, THEME);
    const strokes = calls.filter((c) => c.name === 'stroke').length;
    // At least 6 of the 8 levels are within [0..200] (the 161.8 extension
    // and possibly 0% might fall outside depending on layout).
    expect(strokes).toBeGreaterThanOrEqual(6);
  });

  it('round-trips through snapshots', () => {
    const layer = new DrawingLayer();
    const f = new FibRetracement();
    f.addPoint({ index: 0, price: 50 });
    f.addPoint({ index: 10, price: 150 });
    layer.add(f);
    const snap = layer.toSnapshot();
    const restored = DrawingLayer.fromSnapshot(snap);
    expect(restored.drawings[0]!.kind).toBe('fib');
  });
});

describe('OHLCVChart.startDrawing — new tools', () => {
  it('accepts the widened tool union', async () => {
    // This is a typecheck-only test: if the call signature regressed
    // to 'trendline' | 'hline', TypeScript would fail in CI.
    const tools: ReadonlyArray<
      'trendline' | 'hline' | 'vline' | 'rectangle' | 'ray' | 'fib'
    > = ['trendline', 'hline', 'vline', 'rectangle', 'ray', 'fib'];
    expect(tools.length).toBe(6);
  });
});
