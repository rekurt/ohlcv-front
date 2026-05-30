import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { CrosshairController } from './CrosshairController';
import { ChartEngine } from '../rendering/ChartEngine';
import { CandleBuffer } from '../data/CandleBuffer';
import { DARK_THEME } from '../constants';
import { installCanvasStub } from '../test-utils/canvasStub';
import type { HorzScaleBehavior } from '../horzscale/HorzScaleBehavior';
import type { Candle } from '../types';

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

  it('destroy detaches listeners — further mousemoves are no-ops', async () => {
    controller.destroy();
    setCrosshairSpy.mockClear();
    fireMove(500, 250);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(setCrosshairSpy).not.toHaveBeenCalled();
  });
});
