import { describe, it, expect, beforeEach } from 'vitest';
import { FibExtension } from './FibExtension';
import { Channel } from './Channel';
import { Arrow } from './Arrow';
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

function mockCtx() {
  const calls: { name: string; args: unknown[] }[] = [];
  const target: Record<string, unknown> = { canvas: { width: 800, height: 400 } };
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

describe('FibExtension', () => {
  let vp: Viewport;
  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
    vp.priceMin = 0;
    vp.priceMax = 500;
  });

  it('requires 3 points', () => {
    expect(new FibExtension().requiredPoints).toBe(3);
  });

  it('kind is "fibext"', () => {
    expect(new FibExtension().kind).toBe('fibext');
  });

  it('exposes the canonical 8 levels', () => {
    expect(FibExtension.LEVELS).toEqual([0, 0.382, 0.618, 1.0, 1.272, 1.618, 2.0, 2.618]);
  });

  it('renders lines once all three anchors are set', () => {
    const { ctx, calls } = mockCtx();
    const f = new FibExtension();
    f.addPoint({ index: 0, price: 100 });
    f.addPoint({ index: 5, price: 200 }); // impulse +100
    f.addPoint({ index: 10, price: 150 }); // retrace
    f.render(ctx, LAYOUT, vp, THEME);
    // 8 levels rendered as strokes (some may clip outside).
    expect(calls.filter((c) => c.name === 'stroke').length).toBeGreaterThanOrEqual(6);
  });

  it('round-trips through DrawingLayer snapshots', () => {
    const layer = new DrawingLayer();
    const f = new FibExtension();
    f.addPoint({ index: 0, price: 100 });
    f.addPoint({ index: 5, price: 200 });
    f.addPoint({ index: 10, price: 150 });
    layer.add(f);
    const snap = layer.toSnapshot();
    expect(snap[0]!.kind).toBe('fibext');
    expect(snap[0]!.points).toHaveLength(3);
    const restored = DrawingLayer.fromSnapshot(snap);
    expect(restored.drawings[0]!.kind).toBe('fibext');
  });
});

describe('Channel', () => {
  let vp: Viewport;
  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
    vp.priceMin = 0;
    vp.priceMax = 200;
    vp.startIndex = 0;
    vp.visibleCount = 50;
  });

  it('requires 3 points', () => {
    expect(new Channel().requiredPoints).toBe(3);
  });

  it('kind is "channel"', () => {
    expect(new Channel().kind).toBe('channel');
  });

  it('skips vertical degenerate (A.index === B.index)', () => {
    const { ctx, calls } = mockCtx();
    const ch = new Channel();
    ch.addPoint({ index: 5, price: 100 });
    ch.addPoint({ index: 5, price: 150 });
    ch.addPoint({ index: 10, price: 130 });
    ch.render(ctx, LAYOUT, vp, THEME);
    expect(calls.some((c) => c.name === 'stroke')).toBe(false);
  });

  it('draws fill + 2 boundary strokes when complete', () => {
    const { ctx, calls } = mockCtx();
    const ch = new Channel();
    ch.addPoint({ index: 0, price: 100 });
    ch.addPoint({ index: 30, price: 130 });
    ch.addPoint({ index: 15, price: 110 });
    ch.render(ctx, LAYOUT, vp, THEME);
    expect(calls.some((c) => c.name === 'fill')).toBe(true);
    expect(calls.filter((c) => c.name === 'stroke').length).toBe(2);
  });
});

describe('Arrow', () => {
  let vp: Viewport;
  beforeEach(() => {
    vp = new Viewport();
    vp.setLayout(LAYOUT);
    vp.priceMin = 0;
    vp.priceMax = 200;
  });

  it('requires 2 points', () => {
    expect(new Arrow().requiredPoints).toBe(2);
  });

  it('kind is "arrow"', () => {
    expect(new Arrow().kind).toBe('arrow');
  });

  it('skips degenerate (coincident anchors)', () => {
    const { ctx, calls } = mockCtx();
    const ar = new Arrow();
    ar.addPoint({ index: 5, price: 100 });
    ar.addPoint({ index: 5, price: 100 });
    ar.render(ctx, LAYOUT, vp, THEME);
    expect(calls.some((c) => c.name === 'stroke')).toBe(false);
    expect(calls.some((c) => c.name === 'fill')).toBe(false);
  });

  it('draws shaft + filled head when complete', () => {
    const { ctx, calls } = mockCtx();
    const ar = new Arrow();
    ar.addPoint({ index: 0, price: 100 });
    ar.addPoint({ index: 10, price: 150 });
    ar.render(ctx, LAYOUT, vp, THEME);
    expect(calls.some((c) => c.name === 'stroke')).toBe(true);
    expect(calls.some((c) => c.name === 'fill')).toBe(true);
  });
});
