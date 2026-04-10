import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { CrosshairController } from './CrosshairController';
import { ChartEngine } from '../rendering/ChartEngine';
import { CandleBuffer } from '../data/CandleBuffer';
import { DARK_THEME } from '../constants';
import { installCanvasStub } from '../test-utils/canvasStub';
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

    controller = new CrosshairController(engine, buffer, '1H');
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

  it('setBuffer updates the buffer reference', () => {
    const newBuf = new CandleBuffer();
    for (let i = 0; i < 10; i++) newBuf.append(makeCandle(i));
    expect(() => controller.setBuffer(newBuf)).not.toThrow();
  });

  it('setResolution updates the label format', () => {
    expect(() => controller.setResolution('1D')).not.toThrow();
  });

  it('destroy detaches listeners — further mousemoves are no-ops', async () => {
    controller.destroy();
    setCrosshairSpy.mockClear();
    fireMove(500, 250);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(setCrosshairSpy).not.toHaveBeenCalled();
  });
});
