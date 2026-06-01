import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { getSeriesType, listSeriesTypes, registerSeriesType } from './registry';
import { buildHeikinAshiView } from '../rendering/HeikinAshiRenderer';
import { ChartEngine } from '../rendering/ChartEngine';
import { CandleBuffer } from '../data/CandleBuffer';
import { DARK_THEME, PRICE_PADDING_RATIO } from '../constants';
import { installCanvasStub } from '../test-utils/canvasStub';
import type { SeriesDefinition } from './Series';
import type { Candle } from '../types';

function makeCandle(i: number): Candle {
  const c = 100 + Math.sin(i / 4) * 10 + i * 0.1;
  const o = 100 + Math.sin((i - 1) / 4) * 10 + (i - 1) * 0.1;
  return { o, h: Math.max(o, c) + 3, l: Math.min(o, c) - 3, c, v: 100 + i, t: 1_700_000_000 + i * 60 };
}

function fillEngine(engine: ChartEngine, n: number): CandleBuffer {
  const buf = new CandleBuffer();
  for (let i = 0; i < n; i++) buf.append(makeCandle(i));
  engine.setBuffer(buf);
  engine.viewport.scrollToEnd(buf.length);
  return buf;
}

function forceRender(engine: ChartEngine): void {
  (engine as unknown as { _render: () => void })._render();
}

describe('series registry', () => {
  it('registers all five built-in types', () => {
    for (const t of ['candles', 'line', 'area', 'ohlc', 'heikinashi']) {
      expect(getSeriesType(t)?.type).toBe(t);
    }
    expect(listSeriesTypes()).toEqual(expect.arrayContaining(['candles', 'heikinashi']));
  });

  it('returns undefined for an unregistered type', () => {
    expect(getSeriesType('does-not-exist')).toBeUndefined();
  });

  it('registerSeriesType adds a custom definition', () => {
    const def: SeriesDefinition = { type: 'test:custom-reg', draw: () => {} };
    registerSeriesType(def);
    expect(getSeriesType('test:custom-reg')).toBe(def);
  });
});

describe('ChartEngine series dispatch', () => {
  let container: HTMLDivElement;
  let engine: ChartEngine;

  beforeAll(() => installCanvasStub());

  beforeEach(() => {
    container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({ width: 1000, height: 500, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, toJSON() {} }) as DOMRect;
    document.body.appendChild(container);
    engine = new ChartEngine(container, DARK_THEME);
  });

  afterEach(() => {
    engine.destroy();
    container.remove();
  });

  it('dispatches to a registered custom series', () => {
    const draw = vi.fn();
    registerSeriesType({ type: 'test:dispatch', draw });
    fillEngine(engine, 50);
    engine.setChartType('test:dispatch');
    forceRender(engine);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it('falls back to candles for an unknown chartType (no throw)', () => {
    fillEngine(engine, 50);
    engine.setChartType('test:never-registered');
    expect(() => forceRender(engine)).not.toThrow();
  });

  it('autoscales via a custom priceRange (close-only is tighter than high/low)', () => {
    const buf = fillEngine(engine, 80);

    // Candles: range spans high/low.
    engine.setChartType('candles');
    forceRender(engine);
    const candleMax = engine.viewport.priceMax;

    // Close-only custom series: range should be tighter (ignores the +3 highs).
    registerSeriesType({
      type: 'test:closeonly',
      draw: () => {},
      priceRange: (view, i) => ({ min: view.close[i]!, max: view.close[i]! }),
    });
    engine.setChartType('test:closeonly');
    forceRender(engine);
    const closeMax = engine.viewport.priceMax;

    expect(closeMax).toBeLessThan(candleMax);
    expect(buf.length).toBe(80);
  });

  it('autoscale excludes the +1 render-only bar on the transformed path', () => {
    registerSeriesType({
      type: 'test:rangebar',
      draw: () => {},
      priceRange: (view, i) => ({ min: view.low[i]!, max: view.high[i]! }),
    });
    const buf = new CandleBuffer();
    for (let i = 0; i < 5; i++) {
      const high = i === 4 ? 99_999 : 101; // index 4 is the +1 render bar at visibleCount=4
      buf.append({ o: 100, h: high, l: 99, c: 100, v: 10, t: 1_700_000_000 + i * 60 });
    }
    engine.setBuffer(buf);
    engine.viewport.startIndex = 0;
    engine.viewport.visibleCount = 4; // visible [0,4); index 4 is off-screen
    engine.setChartType('test:rangebar');
    forceRender(engine);
    // priceMax reflects only the visible bars (~101), not the off-screen spike.
    expect(engine.viewport.priceMax).toBeLessThan(1000);
  });

  it('Heikin-Ashi now feeds autoscale from the HA view (bug fix)', () => {
    const buf = fillEngine(engine, 80);
    engine.setChartType('heikinashi');
    forceRender(engine);

    // Reconstruct the HA view for the visible window and confirm the
    // viewport range matches its high/low (+ padding), not the raw OHLC.
    const vp = engine.viewport;
    const start = Math.max(0, Math.floor(vp.startIndex));
    const end = Math.min(buf.length, Math.ceil(vp.startIndex + vp.visibleCount) + 1);
    const ha = buildHeikinAshiView(buf, start, end);
    let haMin = Infinity;
    let haMax = -Infinity;
    for (let i = 0; i < ha.length; i++) {
      if (ha.low[i]! < haMin) haMin = ha.low[i]!;
      if (ha.high[i]! > haMax) haMax = ha.high[i]!;
    }
    const range = haMax - haMin;
    expect(vp.priceMin).toBeCloseTo(haMin - range * PRICE_PADDING_RATIO, 4);
    expect(vp.priceMax).toBeCloseTo(haMax + range * PRICE_PADDING_RATIO, 4);
  });
});
