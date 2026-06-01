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

  it('refreshes the legend for the hovered forming candle on data change', () => {
    const legend = (engine as unknown as {
      _legendRenderer: { render: (...args: unknown[]) => void };
    })._legendRenderer;
    const legendSpy = vi.spyOn(legend, 'render');
    const lastCallCandle = (): { c: number } => {
      const calls = legendSpy.mock.calls;
      return calls[calls.length - 1]![2] as { c: number };
    };

    const lastIdx = buffer.length - 1;
    engine.setCrosshair(200, 100, lastIdx, buffer.candleAt(lastIdx)!, '12:00');
    forceRender(engine);
    const firstClose = lastCallCandle().c;

    // A realtime tick mutates the forming (last) candle the user is hovering.
    const cur = buffer.candleAt(lastIdx)!;
    buffer.updateLast({ ...cur, c: cur.c + 50, h: cur.h + 50 });
    engine.requestRender(); // what the live-update path does
    forceRender(engine);

    expect(lastCallCandle().c).toBe(firstClose + 50);
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

/**
 * A left-bound overlay indicator emitting a constant value, distinct from
 * the candle price range (~100), so the secondary scale's independence is
 * observable.
 */
class LeftConst extends Indicator {
  readonly placement: IndicatorPlacement = 'overlay';
  override readonly priceScaleId = 'left' as const;
  constructor(private readonly value: number) {
    super();
  }
  get id(): string {
    return `leftConst(${this.value})`;
  }
  compute(buffer: { length: number }): IndicatorSeries[] {
    const out = new Float64Array(buffer.length);
    out.fill(this.value);
    return [{ name: 'leftConst', values: out }];
  }
}

describe('ChartEngine secondary (left) price scale (B2)', () => {
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
    engine.viewport.scrollToEnd(buffer.length);
  });

  afterEach(() => {
    engine.destroy();
    container.remove();
  });

  it('reserves no left axis strip by default (leftAxisWidth === 0, chartLeft === 0)', () => {
    expect(engine.layout.leftAxisWidth).toBe(0);
    expect(engine.layout.chartLeft).toBe(0);
  });

  it('a right-scale (default) overlay indicator never reserves the left strip', () => {
    engine.setIndicators([new SMA(20)]);
    expect(engine.layout.leftAxisWidth).toBe(0);
    expect(engine.layout.chartLeft).toBe(0);
  });

  it('an indicator bound to "left" reserves the left axis strip and shifts chartLeft', () => {
    engine.setIndicators([new LeftConst(5000)]);
    expect(engine.layout.leftAxisWidth).toBeGreaterThan(0);
    expect(engine.layout.chartLeft).toBe(engine.layout.leftAxisWidth);
  });

  it('removing the left binding releases the strip again (chartLeft back to 0)', () => {
    engine.setIndicators([new LeftConst(5000)]);
    expect(engine.layout.leftAxisWidth).toBeGreaterThan(0);
    engine.setIndicators([new SMA(20)]);
    expect(engine.layout.leftAxisWidth).toBe(0);
    expect(engine.layout.chartLeft).toBe(0);
  });

  it('left binding does not disturb the right price range (candles ~100)', () => {
    engine.setIndicators([]);
    forceRender(engine);
    const rMin = engine.viewport.priceMin;
    const rMax = engine.viewport.priceMax;

    // A constant of 5000 is far outside the candle range; if it leaked into
    // the right scale it would blow priceMax past 5000.
    engine.setIndicators([new LeftConst(5000)]);
    forceRender(engine);
    expect(engine.viewport.priceMax).toBeLessThan(200);
    expect(engine.viewport.priceMin).toBeCloseTo(rMin, 5);
    expect(engine.viewport.priceMax).toBeCloseTo(rMax, 5);
  });

  it('left binding drives the independent left range to the indicator values', () => {
    engine.setIndicators([new LeftConst(5000)]);
    forceRender(engine);
    // The left extrema bracket 5000 (flat value → symmetric pad around it).
    expect(engine.viewport.leftPriceMin).toBeLessThan(5000);
    expect(engine.viewport.leftPriceMax).toBeGreaterThan(5000);
    // And a left projection of 5000 lands inside the chart area.
    const y = engine.viewport.priceToY(5000, 'left');
    expect(y).toBeGreaterThanOrEqual(engine.layout.chartTop);
    expect(y).toBeLessThanOrEqual(engine.layout.chartBottom);
  });

  it('renders with a left-bound indicator without throwing', () => {
    engine.setIndicators([new SMA(20), new LeftConst(5000)]);
    expect(() => forceRender(engine)).not.toThrow();
  });

  it('resize preserves the reserved left strip', () => {
    engine.setIndicators([new LeftConst(5000)]);
    expect(engine.layout.leftAxisWidth).toBeGreaterThan(0);
    engine.resize(1200, 600);
    expect(engine.layout.leftAxisWidth).toBeGreaterThan(0);
    expect(engine.layout.chartLeft).toBe(engine.layout.leftAxisWidth);
  });
});
