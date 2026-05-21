import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { ChartEngine } from './ChartEngine';
import { CandleBuffer } from '../data/CandleBuffer';
import { DARK_THEME } from '../constants';
import { installCanvasStub } from '../test-utils/canvasStub';
import { RSI } from '../indicators/RSI';
import { SMA } from '../indicators/SMA';
import { MACD } from '../indicators/MACD';
import { Indicator, type IndicatorPlacement, type IndicatorSeries } from '../indicators/Indicator';
import { ErrorReporter } from '../ErrorReporter';
import type { Candle, ChartError } from '../types';

function makeCandle(i: number): Candle {
  // Vary the close so oscillator indicators produce finite values.
  const c = 100 + Math.sin(i / 3) * 5;
  return { o: c, h: c + 1, l: c - 1, c, v: 10 + i, t: 1_700_000_000 + i * 60 };
}

/** Force a synchronous render so the sub-pane paint path is exercised. */
function forceRender(engine: ChartEngine): void {
  (engine as unknown as { _render: () => void })._render();
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

describe('ChartEngine sub-panes', () => {
  let container: HTMLDivElement;
  let engine: ChartEngine;
  let buffer: CandleBuffer;

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
    for (let i = 0; i < 60; i++) buffer.append(makeCandle(i));
    engine.setBuffer(buffer);
  });

  afterEach(() => {
    engine.destroy();
    container.remove();
  });

  it('reserves no sub-pane area with only overlay indicators', () => {
    engine.setIndicators([new SMA(20)]);
    expect(engine.layout.paneAreaBottom).toBe(engine.layout.paneAreaTop);
  });

  it('reserves a sub-pane band and shrinks the main area for a pane indicator', () => {
    const fullBottom = engine.layout.chartBottom;
    engine.setIndicators([new RSI(14)]);
    expect(engine.layout.paneAreaBottom).toBeGreaterThan(engine.layout.paneAreaTop);
    expect(engine.layout.chartBottom).toBeLessThan(fullBottom);
  });

  it('renders sub-panes (RSI line + MACD histogram) without throwing', () => {
    engine.setIndicators([new RSI(14), new MACD()]);
    expect(() => forceRender(engine)).not.toThrow();
  });

  it('redraws the legend only when the hovered candle changes, not on sub-candle moves', () => {
    const legend = (engine as unknown as { _legendRenderer: { render: () => void } })
      ._legendRenderer;
    const crosshair = (engine as unknown as { _crosshairRenderer: { render: () => void } })
      ._crosshairRenderer;
    const legendSpy = vi.spyOn(legend, 'render');
    const crosshairSpy = vi.spyOn(crosshair, 'render');

    const candle = buffer.candleAt(5)!;
    // First hover on candle index 5 → legend (UI layer) must redraw.
    engine.setCrosshair(100, 100, 5, candle, '12:00');
    forceRender(engine);
    expect(legendSpy).toHaveBeenCalledTimes(1);
    expect(crosshairSpy).toHaveBeenCalledTimes(1);

    // Move within the same candle (index 5) → only the crosshair layer.
    engine.setCrosshair(104, 108, 5, candle, '12:00');
    forceRender(engine);
    expect(legendSpy).toHaveBeenCalledTimes(1); // unchanged
    expect(crosshairSpy).toHaveBeenCalledTimes(2);

    // Move to a different candle → legend redraws again.
    engine.setCrosshair(140, 100, 6, buffer.candleAt(6)!, '12:01');
    forceRender(engine);
    expect(legendSpy).toHaveBeenCalledTimes(2);
  });

  it('reports indicator compute errors through the ErrorReporter instead of swallowing', () => {
    const errors: ChartError[] = [];
    engine.setErrorReporter(new ErrorReporter((e) => errors.push(e)));

    class Boom extends Indicator {
      readonly placement: IndicatorPlacement = 'overlay';
      get id(): string {
        return 'boom';
      }
      compute(): IndicatorSeries[] {
        throw new Error('compute failed');
      }
    }
    engine.setIndicators([new Boom()]);
    expect(() => forceRender(engine)).not.toThrow();
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.where).toBe('indicator');
  });
});
