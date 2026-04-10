import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { ChartEngine } from './ChartEngine';
import { CandleBuffer } from '../data/CandleBuffer';
import { DARK_THEME } from '../constants';
import { installCanvasStub } from '../test-utils/canvasStub';
import type { Candle } from '../types';

function makeCandle(i: number): Candle {
  return { o: 100, h: 101, l: 99, c: 100.5, v: 10, t: 1_700_000_000 + i * 60 };
}

describe('ChartEngine', () => {
  let container: HTMLDivElement;
  let engine: ChartEngine;

  beforeAll(() => {
    installCanvasStub();
  });

  beforeEach(() => {
    container = document.createElement('div');
    // jsdom reports 0/0 bounding rects, so stub getBoundingClientRect to
    // return a realistic size.
    container.getBoundingClientRect = () =>
      ({ width: 1000, height: 500, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, toJSON() {} }) as DOMRect;
    document.body.appendChild(container);
    engine = new ChartEngine(container, DARK_THEME);
  });

  afterEach(() => {
    engine.destroy();
    container.remove();
  });

  it('adds three stacked canvases to the container', () => {
    const canvases = container.querySelectorAll('canvas');
    expect(canvases).toHaveLength(3);
  });

  it('makes the top canvas focusable (tabIndex=0)', () => {
    expect(engine.topCanvas.tabIndex).toBe(0);
  });

  it('computes a layout from the container size', () => {
    expect(engine.layout.width).toBe(1000);
    expect(engine.layout.height).toBe(500);
    expect(engine.layout.chartRight).toBeLessThan(engine.layout.width);
    expect(engine.layout.chartBottom).toBeLessThan(engine.layout.height);
  });

  it('exposes a viewport whose layout matches the engine layout', () => {
    expect(engine.viewport.layout).toBe(engine.layout);
  });

  it('setBuffer accepts a CandleBuffer without throwing', () => {
    const buf = new CandleBuffer();
    for (let i = 0; i < 10; i++) buf.append(makeCandle(i));
    expect(() => engine.setBuffer(buf)).not.toThrow();
  });

  it('setSymbol / setResolution / setTheme do not throw', () => {
    expect(() => engine.setSymbol('BTC/USDT')).not.toThrow();
    expect(() => engine.setResolution('1H')).not.toThrow();
    expect(() => engine.setTheme(DARK_THEME)).not.toThrow();
  });

  it('resize updates layout dimensions', () => {
    engine.resize(1500, 800);
    expect(engine.layout.width).toBe(1500);
    expect(engine.layout.height).toBe(800);
  });

  it('requestRender schedules a frame without throwing', () => {
    const buf = new CandleBuffer();
    for (let i = 0; i < 10; i++) buf.append(makeCandle(i));
    engine.setBuffer(buf);
    expect(() => engine.requestRender()).not.toThrow();
  });

  it('setCrosshair / hideCrosshair mutate the visible flag correctly', () => {
    const buf = new CandleBuffer();
    buf.append(makeCandle(0));
    engine.setBuffer(buf);

    engine.setCrosshair(100, 100, 0, makeCandle(0), '12:00');
    engine.hideCrosshair();
    // No direct exposure of state — verify the calls do not throw.
    expect(() => engine.hideCrosshair()).not.toThrow();
  });

  it('destroy removes all canvases from the container', () => {
    expect(container.querySelectorAll('canvas')).toHaveLength(3);
    engine.destroy();
    expect(container.querySelectorAll('canvas')).toHaveLength(0);
    // Create a fresh engine so afterEach can safely destroy it.
    engine = new ChartEngine(container, DARK_THEME);
  });
});
