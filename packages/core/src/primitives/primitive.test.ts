import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { ChartEngine } from '../rendering/ChartEngine';
import { CandleBuffer } from '../data/CandleBuffer';
import { DARK_THEME } from '../constants';
import { installCanvasStub } from '../test-utils/canvasStub';
import { clipToChart, type Primitive, type PrimitiveZOrder } from './Primitive';
import type { Candle } from '../types';

function makeCandle(i: number): Candle {
  const c = 100 + Math.sin(i / 3) * 5;
  return { o: c, h: c + 1, l: c - 1, c, v: 10 + i, t: 1_700_000_000 + i * 60 };
}

function forceRender(engine: ChartEngine): void {
  (engine as unknown as { _render: () => void })._render();
}

describe('clipToChart', () => {
  it('applies a rect clip to the chart area', () => {
    const calls: string[] = [];
    const ctx = {
      beginPath: () => calls.push('beginPath'),
      rect: (x: number, y: number, w: number, h: number) => calls.push(`rect(${x},${y},${w},${h})`),
      clip: () => calls.push('clip'),
    } as unknown as CanvasRenderingContext2D;
    const layout = { chartLeft: 0, chartTop: 0, chartRight: 920, chartBottom: 400 } as never;
    clipToChart(ctx, layout);
    expect(calls).toEqual(['beginPath', 'rect(0,0,920,400)', 'clip']);
  });
});

describe('ChartEngine primitives', () => {
  let container: HTMLDivElement;
  let engine: ChartEngine;

  beforeAll(() => {
    installCanvasStub();
  });

  beforeEach(() => {
    container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({ width: 1000, height: 500, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, toJSON() {} }) as DOMRect;
    document.body.appendChild(container);
    engine = new ChartEngine(container, DARK_THEME);
    const buf = new CandleBuffer();
    for (let i = 0; i < 30; i++) buf.append(makeCandle(i));
    engine.setBuffer(buf);
  });

  afterEach(() => {
    engine.destroy();
    container.remove();
  });

  function recordingPrimitive(id: string, zOrder: PrimitiveZOrder, draw: () => void = () => {}): Primitive {
    return { id, zOrder, draw };
  }

  it('draws an attached primitive and stops after detach', () => {
    const draw = vi.fn();
    const p = recordingPrimitive('p1', 'normal', draw);
    engine.attachPrimitive(p);
    forceRender(engine);
    expect(draw).toHaveBeenCalledTimes(1);

    expect(engine.detachPrimitive('p1')).toBe(true);
    forceRender(engine);
    expect(draw).toHaveBeenCalledTimes(1); // unchanged — no longer drawn
  });

  it('detach by unknown id is a no-op', () => {
    expect(engine.detachPrimitive('nope')).toBe(false);
  });

  it('exposes attached primitives in attach order', () => {
    engine.attachPrimitive(recordingPrimitive('a', 'bottom'));
    engine.attachPrimitive(recordingPrimitive('b', 'top'));
    expect(engine.primitives.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('paints bottom tier before the grid and top tier after the legend', () => {
    let seq = 0;
    const order: Record<string, number> = {};

    const grid = (engine as unknown as { _gridRenderer: { render: () => void } })._gridRenderer;
    const legend = (engine as unknown as { _legendRenderer: { render: () => void } })._legendRenderer;
    vi.spyOn(grid, 'render').mockImplementation(() => {
      order.grid = seq++;
    });
    vi.spyOn(legend, 'render').mockImplementation(() => {
      order.legend = seq++;
    });

    engine.attachPrimitive(recordingPrimitive('wm', 'bottom', () => (order.bottom = seq++)));
    engine.attachPrimitive(recordingPrimitive('pl', 'top', () => (order.top = seq++)));
    forceRender(engine);

    expect(order.bottom).toBeLessThan(order.grid!);
    expect(order.top).toBeGreaterThan(order.legend!);
  });

  it('hitTestPrimitives returns the topmost matching primitive', () => {
    const lower: Primitive = {
      id: 'lower',
      zOrder: 'top',
      draw: () => {},
      hitTest: () => true,
    };
    const upper: Primitive = {
      id: 'upper',
      zOrder: 'top',
      draw: () => {},
      hitTest: () => true,
    };
    engine.attachPrimitive(lower);
    engine.attachPrimitive(upper);
    // Last attached is topmost in reverse paint order.
    expect(engine.hitTestPrimitives(100, 100)?.id).toBe('upper');

    expect(engine.detachPrimitive('upper')).toBe(true);
    expect(engine.hitTestPrimitives(100, 100)?.id).toBe('lower');
  });

  it('hitTestPrimitives ignores primitives without a hitTest and misses', () => {
    engine.attachPrimitive(recordingPrimitive('nohit', 'normal'));
    engine.attachPrimitive({
      id: 'miss',
      zOrder: 'top',
      draw: () => {},
      hitTest: () => false,
    });
    expect(engine.hitTestPrimitives(100, 100)).toBeNull();
  });
});
