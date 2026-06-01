import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { CrosshairController } from './CrosshairController';
import { ChartEngine } from '../rendering/ChartEngine';
import { CandleBuffer } from '../data/CandleBuffer';
import { DARK_THEME } from '../constants';
import { installCanvasStub } from '../test-utils/canvasStub';
import type { HorzScaleBehavior } from '../horzscale/HorzScaleBehavior';
import type { Candle, HoverInfo } from '../types';
import type { Primitive } from '../primitives/Primitive';

function makeCandle(i: number): Candle {
  return { o: 100, h: 101, l: 99, c: 100.5, v: 10, t: 1_700_000_000 + i * 60 };
}

describe('CrosshairController', () => {
  let container: HTMLDivElement;
  let engine: ChartEngine;
  let buffer: CandleBuffer;
  let controller: CrosshairController;
  let setCrosshairSpy: ReturnType<typeof vi.spyOn>;
  let hideCrosshairSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    installCanvasStub();
  });

  beforeEach(() => {
    container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({ width: 1000, height: 500, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, toJSON() {} }) as DOMRect;
    document.body.appendChild(container);

    engine = new ChartEngine(container, DARK_THEME);
    buffer = new CandleBuffer();
    for (let i = 0; i < 100; i++) buffer.append(makeCandle(i));
    engine.setBuffer(buffer);
    engine.viewport.scrollToEnd(buffer.length);
    engine.viewport.autoScale(buffer);

    setCrosshairSpy = vi.spyOn(engine, 'setCrosshair');
    hideCrosshairSpy = vi.spyOn(engine, 'hideCrosshair');

    // Same rect for topCanvas — normally computed from DOM layout.
    engine.topCanvas.getBoundingClientRect = container.getBoundingClientRect;

    engine.setResolution('1H');
    controller = new CrosshairController(engine, buffer);
  });

  afterEach(() => {
    controller.destroy();
    engine.destroy();
    container.remove();
  });

  function fireMove(clientX: number, clientY: number): void {
    engine.topCanvas.dispatchEvent(
      new MouseEvent('mousemove', { clientX, clientY, bubbles: true }),
    );
  }

  function fireLeave(): void {
    engine.topCanvas.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
  }

  function fireDblClick(clientX: number, clientY: number): void {
    engine.topCanvas.dispatchEvent(
      new MouseEvent('dblclick', { clientX, clientY, bubbles: true }),
    );
  }

  it('sets crosshair cursor style on the top canvas', () => {
    expect(engine.topCanvas.style.cursor).toBe('crosshair');
  });

  it('mousemove inside chart area schedules a RAF that calls setCrosshair', async () => {
    fireMove(500, 250);
    // Wait for the next animation frame so the RAF-throttled handler fires.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(setCrosshairSpy).toHaveBeenCalled();
  });

  it('mouseleave hides the crosshair immediately', () => {
    fireLeave();
    expect(hideCrosshairSpy).toHaveBeenCalledOnce();
  });

  it('multiple rapid mousemove events coalesce into a single RAF callback', async () => {
    fireMove(500, 250);
    fireMove(510, 260);
    fireMove(520, 270);
    // Before the frame fires, no setCrosshair should have happened
    // (they were all coalesced into one pending RAF).
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    // At most one RAF flush → one setCrosshair call with the latest coords
    expect(setCrosshairSpy).toHaveBeenCalledTimes(1);
  });

  it('mousemove outside the chart area hides the crosshair', async () => {
    // x > chartRight — jsdom canvas bounds start at 0 and the price axis
    // reserves the right PRICE_AXIS_WIDTH pixels. Passing chartRight + 5
    // puts us into the axis area.
    fireMove(engine.layout.chartRight + 5, 250);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(hideCrosshairSpy).toHaveBeenCalled();
  });

  it('keeps the crosshair visible when hovering an indicator sub-pane', async () => {
    // Add a pane indicator so the layout reserves a sub-pane band below
    // the main price area (chartBottom < paneAreaBottom).
    const { RSI } = await import('../indicators/RSI');
    engine.setIndicators([new RSI(14)]);
    expect(engine.layout.paneAreaBottom).toBeGreaterThan(engine.layout.chartBottom);

    // Hover inside the sub-pane band: below chartBottom but above paneAreaBottom.
    const subPaneY = (engine.layout.chartBottom + engine.layout.paneAreaBottom) / 2;
    fireMove(500, subPaneY);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    expect(setCrosshairSpy).toHaveBeenCalled();
    const yArg = setCrosshairSpy.mock.calls.at(-1)![1] as number;
    expect(yArg).toBeGreaterThan(engine.layout.chartBottom);
  });

  it('setBuffer updates the buffer reference', () => {
    const newBuf = new CandleBuffer();
    for (let i = 0; i < 10; i++) newBuf.append(makeCandle(i));
    expect(() => controller.setBuffer(newBuf)).not.toThrow();
  });

  it('labels the crosshair via the engine horizontal-scale behavior', async () => {
    // Default time behavior → label is formatTime(candle.t, resolution).
    fireMove(500, 250);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const label = setCrosshairSpy.mock.calls.at(-1)![4] as string;
    expect(label).toMatch(/^\d{2}:\d{2}$/);
  });

  it('derives the crosshair label via fromLogical, not candle.t', async () => {
    // Custom behavior whose domain value is unrelated to the raw timestamp:
    // fromLogical returns a constant. The crosshair must format THAT, proving
    // it goes through fromLogical (candle.t would yield a timestamp instead).
    const custom: HorzScaleBehavior = {
      uniform: true,
      toLogical: () => 0,
      fromLogical: () => 42,
      formatValue: (v) => `v=${v}`,
    };
    engine.setHorzScale(custom);
    fireMove(500, 250);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const label = setCrosshairSpy.mock.calls.at(-1)![4] as string;
    expect(label).toBe('v=42');
  });

  it('normal mode (default) passes the raw cursor Y to setCrosshair', async () => {
    fireMove(500, 250);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const yArg = setCrosshairSpy.mock.calls.at(-1)![1] as number;
    expect(yArg).toBe(250);
  });

  it('magnet mode snaps crosshair Y to the nearest OHLC level of the hovered candle', async () => {
    controller.setMode('magnet');
    fireMove(500, 250);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    const call = setCrosshairSpy.mock.calls.at(-1)!;
    const yArg = call[1] as number;
    const index = call[2] as number;
    const candle = buffer.candleAt(index)!;
    const levelYs = [candle.o, candle.h, candle.l, candle.c].map((p) =>
      engine.viewport.priceToY(p),
    );
    // The snapped Y must equal one of the four OHLC pixel levels exactly.
    expect(levelYs.some((ly) => Math.abs(ly - yArg) < 1e-6)).toBe(true);
    // And it must be the closest one to the raw cursor Y (250).
    const nearest = levelYs.reduce((a, b) => (Math.abs(b - 250) < Math.abs(a - 250) ? b : a));
    expect(yArg).toBeCloseTo(nearest, 6);
  });

  it('reports paneIndex 0 when hovering the main price pane', async () => {
    const onHover = vi.fn<(info: HoverInfo | null) => void>();
    controller.setOnHover(onHover);
    // Mid-height of the main chart area → main pane.
    fireMove(500, engine.layout.chartTop + 10);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const info = onHover.mock.lastCall![0] as HoverInfo;
    expect(info).not.toBeNull();
    expect(info.paneIndex).toBe(0);
  });

  it('reports paneIndex > 0 when hovering an indicator sub-pane', async () => {
    const { RSI } = await import('../indicators/RSI');
    engine.setIndicators([new RSI(14)]);
    expect(engine.layout.paneCount).toBe(1);
    expect(engine.layout.paneAreaBottom).toBeGreaterThan(engine.layout.chartBottom);

    const onHover = vi.fn<(info: HoverInfo | null) => void>();
    controller.setOnHover(onHover);
    // Inside the single sub-pane band (below chartBottom, above paneAreaBottom).
    const subPaneY = (engine.layout.chartBottom + engine.layout.paneAreaBottom) / 2;
    fireMove(500, subPaneY);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const info = onHover.mock.lastCall![0] as HoverInfo;
    expect(info).not.toBeNull();
    expect(info.paneIndex).toBe(1);
  });

  it('reports hovered === null when nothing interactive is under the cursor', async () => {
    const onHover = vi.fn<(info: HoverInfo | null) => void>();
    controller.setOnHover(onHover);
    fireMove(500, 250);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const info = onHover.mock.lastCall![0] as HoverInfo;
    expect(info).not.toBeNull();
    expect(info.hovered).toBeNull();
  });

  it('reports hovered.kind/id for an attached primitive under the cursor', async () => {
    // A primitive whose hitTest passes anywhere → it is the topmost object.
    const primitive: Primitive = {
      id: 'prim-1',
      zOrder: 'top',
      draw: () => {},
      hitTest: () => true,
    };
    engine.attachPrimitive(primitive);

    const onHover = vi.fn<(info: HoverInfo | null) => void>();
    controller.setOnHover(onHover);
    fireMove(500, 250);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const info = onHover.mock.lastCall![0] as HoverInfo;
    expect(info).not.toBeNull();
    expect(info.hovered).toEqual({ kind: 'primitive', id: 'prim-1' });
  });

  it('prefers a hit drawing over a primitive (priority order)', async () => {
    const { HorizontalLine } = await import('../drawings/HorizontalLine');
    const { DrawingLayer } = await import('../drawings/DrawingLayer');
    const layer = new DrawingLayer();
    // Anchor the line at the price under cursor Y=250 so its full-width
    // geometry sits exactly under the cursor.
    const price = engine.viewport.yToPrice(250);
    const line = new HorizontalLine();
    line.addPoint({ index: 0, price });
    layer.add(line);
    engine.setDrawingLayer(layer);

    // Also attach a primitive that would match — the drawing must win.
    engine.attachPrimitive({ id: 'p', zOrder: 'top', draw: () => {}, hitTest: () => true });

    const onHover = vi.fn<(info: HoverInfo | null) => void>();
    controller.setOnHover(onHover);
    fireMove(500, 250);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const info = onHover.mock.lastCall![0] as HoverInfo;
    expect(info).not.toBeNull();
    expect(info.hovered).toEqual({ kind: 'drawing', id: line.id });
  });

  it('invokes onDblClick with a non-null HoverInfo on a dblclick inside the plot', () => {
    const onDbl = vi.fn<(info: HoverInfo | null) => void>();
    controller.setOnDblClick(onDbl);
    fireDblClick(500, 250);
    expect(onDbl).toHaveBeenCalledTimes(1);
    const info = onDbl.mock.calls[0]![0] as HoverInfo | null;
    expect(info).not.toBeNull();
    expect(info!.candle).toBeTruthy();
    expect(info!.paneIndex).toBe(0);
  });

  it('invokes onDblClick with null when the dblclick is outside the plot', () => {
    const onDbl = vi.fn<(info: HoverInfo | null) => void>();
    controller.setOnDblClick(onDbl);
    // Past the right axis → outside the plot area.
    fireDblClick(engine.layout.chartRight + 5, 250);
    expect(onDbl).toHaveBeenCalledTimes(1);
    expect(onDbl.mock.calls[0]![0]).toBeNull();
  });

  it('does not fire onDblClick after destroy', () => {
    const onDbl = vi.fn<(info: HoverInfo | null) => void>();
    controller.setOnDblClick(onDbl);
    controller.destroy();
    fireDblClick(500, 250);
    expect(onDbl).not.toHaveBeenCalled();
  });

  it('destroy detaches listeners — further mousemoves are no-ops', async () => {
    controller.destroy();
    setCrosshairSpy.mockClear();
    fireMove(500, 250);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(setCrosshairSpy).not.toHaveBeenCalled();
  });
});
