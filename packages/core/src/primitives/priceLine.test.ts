import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { PriceLinePrimitive } from './PriceLinePrimitive';
import { PanZoomController } from '../interaction/PanZoomController';
import { Viewport } from '../interaction/Viewport';
import { OHLCVChart } from '../OHLCVChart';
import { computeLayout, formatPrice } from '../utils';
import { DARK_THEME, DRAWING_HIT_TOLERANCE_PX } from '../constants';
import { installCanvasStub } from '../test-utils/canvasStub';
import type { Candle, ChartLayout } from '../types';

const LAYOUT: ChartLayout = computeLayout(1000, 500);

interface Op {
  type: 'call' | 'set';
  name: string;
  args?: unknown[];
}
function makeCtx(): CanvasRenderingContext2D & { __ops: Op[] } {
  const ops: Op[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(
    {},
    {
      get(_t, p: string) {
        if (p === '__ops') return ops;
        if (p === 'measureText') return (t: string) => ({ width: t.length * 6 });
        if (p in props) return props[p];
        return (...args: unknown[]) => ops.push({ type: 'call', name: p, args });
      },
      set(_t, p: string, v: unknown) {
        props[p] = v;
        return true;
      },
    },
  );
  return ctx as unknown as CanvasRenderingContext2D & { __ops: Op[] };
}

function vpWith(min: number, max: number): Viewport {
  const vp = new Viewport();
  vp.setLayout(LAYOUT);
  vp.priceMin = min;
  vp.priceMax = max;
  return vp;
}

describe('PriceLinePrimitive', () => {
  it('is a top-tier primitive', () => {
    expect(new PriceLinePrimitive('p', { price: 100 }).zOrder).toBe('top');
  });

  it('draws the line + pill at priceToY(price)', () => {
    const vp = vpWith(100, 200);
    const ctx = makeCtx();
    new PriceLinePrimitive('p', { price: 150 }).draw(ctx, LAYOUT, vp, DARK_THEME);
    const y = vp.priceToY(150);
    const fillText = ctx.__ops.find((o) => o.name === 'fillText');
    expect(fillText?.args?.[0]).toBe(formatPrice(150));
    expect(fillText?.args?.[2]).toBeCloseTo(y, 6);
  });

  it('uses a custom title when provided', () => {
    const ctx = makeCtx();
    new PriceLinePrimitive('p', { price: 150, title: 'TP' }).draw(ctx, LAYOUT, vpWith(100, 200), DARK_THEME);
    expect(ctx.__ops.find((o) => o.name === 'fillText')?.args?.[0]).toBe('TP');
  });

  it('hitTest is true within tolerance of the line and false outside', () => {
    const vp = vpWith(100, 200);
    const line = new PriceLinePrimitive('p', { price: 150 });
    const y = vp.priceToY(150);
    expect(line.hitTest(400, y, LAYOUT, vp)).toBe(true);
    expect(line.hitTest(400, y + DRAWING_HIT_TOLERANCE_PX + 5, LAYOUT, vp)).toBe(false);
    // Outside the chart horizontally (price-axis strip) → miss.
    expect(line.hitTest(LAYOUT.chartRight + 10, y, LAYOUT, vp)).toBe(false);
  });

  it('hitTest respects the log scale mode', () => {
    const vp = vpWith(10, 1000);
    vp.setScaleMode('log');
    const line = new PriceLinePrimitive('p', { price: 100 });
    const y = vp.priceToY(100);
    expect(line.hitTest(400, y, LAYOUT, vp)).toBe(true);
  });

  it('draggable getter reflects the option; setPrice/setOptions mutate', () => {
    const line = new PriceLinePrimitive('p', { price: 100 });
    expect(line.draggable).toBe(false);
    line.setOptions({ draggable: true, title: 'X' });
    expect(line.draggable).toBe(true);
    line.setPrice(123);
    expect(line.price).toBe(123);
  });
});

describe('PanZoomController price-line drag gate', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON() {} }) as DOMRect;
  });

  it('routes a drag to onDragDraggable with the cursor price, skipping pan', () => {
    const vp = vpWith(100, 200);
    const startBefore = vp.startIndex;
    const onDragDraggable = vi.fn();
    const onDragDraggableEnd = vi.fn();
    const pz = new PanZoomController(canvas, vp, {
      hitTestDraggable: (x, y) => (x < 900 && Math.abs(y - 100) < 10 ? { id: 'L' } : null),
      onDragDraggable,
      onDragDraggableEnd,
    });

    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, button: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 160, bubbles: true }));
    expect(onDragDraggable).toHaveBeenCalledWith('L', vp.yToPrice(160));
    // Pan must NOT have happened.
    expect(vp.startIndex).toBe(startBefore);

    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 160, bubbles: true }));
    expect(onDragDraggableEnd).toHaveBeenCalledWith('L');
    pz.destroy();
  });

  it('falls through to pan when no draggable is hit', () => {
    const vp = vpWith(100, 200);
    vp.scrollToEnd(500);
    const startBefore = vp.startIndex;
    const pz = new PanZoomController(canvas, vp, {
      hitTestDraggable: () => null,
    });
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 300, clientY: 200, button: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 360, clientY: 200, bubbles: true }));
    expect(vp.startIndex).not.toBe(startBefore); // panned
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 360, clientY: 200, bubbles: true }));
    pz.destroy();
  });
});

describe('OHLCVChart.createPriceLine', () => {
  let container: HTMLDivElement;
  let chart: OHLCVChart;

  beforeAll(() => installCanvasStub());

  beforeEach(() => {
    container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({ width: 1000, height: 500, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, toJSON() {} }) as DOMRect;
    document.body.appendChild(container);
    chart = new OHLCVChart({ container, symbol: 'X', resolution: '1H' });
    const candles: Candle[] = [];
    for (let i = 0; i < 50; i++) {
      const c = 100 + i;
      candles.push({ o: c, h: c + 1, l: c - 1, c, v: 10, t: 1_700_000_000 + i * 60 });
    }
    chart.setData(candles);
  });

  afterEach(() => {
    chart.destroy();
    container.remove();
  });

  it('attaches a price line and exposes a working handle', () => {
    const line = chart.createPriceLine({ price: 120, draggable: true });
    expect(chart.getPrimitives().some((p) => p.id === line.id)).toBe(true);

    line.setPrice(130);
    expect(line.getPrice()).toBe(130);

    line.remove();
    expect(chart.getPrimitives().some((p) => p.id === line.id)).toBe(false);
  });

  it('makes a draggable line discoverable via hitTestPrimitives', () => {
    const line = chart.createPriceLine({ price: 120, draggable: true });
    const vp = chart.getViewport();
    const y = vp.priceToY(120);
    const engine = (chart as unknown as { _engine: { hitTestPrimitives: (x: number, y: number) => { id: string } | null } })._engine;
    expect(engine.hitTestPrimitives(400, y)?.id).toBe(line.id);
  });
});
