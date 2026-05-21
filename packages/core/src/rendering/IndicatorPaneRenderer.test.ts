import { describe, it, expect } from 'vitest';
import { IndicatorPaneRenderer } from './IndicatorPaneRenderer';
import { computeLayout } from '../utils';
import { Viewport } from '../interaction/Viewport';
import type { ThemeColors } from '../types';
import type { IndicatorSeries } from '../indicators/Indicator';

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

function series(values: number[], name = 'v'): IndicatorSeries {
  const arr = new Float64Array(values);
  return { name, values: arr };
}

describe('IndicatorPaneRenderer', () => {
  const renderer = new IndicatorPaneRenderer();
  const layout = computeLayout(800, 400, 0);
  const vp = new Viewport();
  vp.setLayout(layout);

  it('exposes a deterministic 7-color palette', () => {
    expect(IndicatorPaneRenderer.SERIES_COLORS.length).toBe(7);
  });

  it('returns 0 series rendered when input is empty', () => {
    const { ctx, calls } = mockCtx();
    const drawn = renderer.render(ctx, layout, vp, [], 300, 380, 'empty', THEME, 0);
    expect(drawn).toBe(0);
    expect(calls.some((c) => c.name === 'stroke')).toBe(false);
  });

  it('returns 0 when pane band is too small', () => {
    const { ctx } = mockCtx();
    const drawn = renderer.render(
      ctx,
      layout,
      vp,
      [series([1, 2, 3])],
      300,
      301,
      'tiny',
      THEME,
      0,
    );
    expect(drawn).toBe(0);
  });

  it('renders one stroke per series', () => {
    const { ctx, calls } = mockCtx();
    const drawn = renderer.render(
      ctx,
      layout,
      vp,
      [series([10, 20, 30, 40, 50]), series([5, 15, 25, 35, 45])],
      300,
      380,
      'two-series',
      THEME,
      0,
    );
    expect(drawn).toBe(2);
    const strokes = calls.filter((c) => c.name === 'stroke').length;
    // top divider + 2 series + potentially the dashed zero line.
    expect(strokes).toBeGreaterThanOrEqual(3);
  });

  it('renders the dashed zero line when the range straddles zero', () => {
    const { ctx, calls } = mockCtx();
    renderer.render(
      ctx,
      layout,
      vp,
      [series([-10, -5, 0, 5, 10])],
      300,
      380,
      'macd-like',
      THEME,
      0,
    );
    // setLineDash([2, 3]) is the zero-line marker.
    const dashCalls = calls.filter(
      (c) =>
        c.name === 'setLineDash' &&
        Array.isArray(c.args[0]) &&
        (c.args[0] as number[])[0] === 2,
    );
    expect(dashCalls.length).toBeGreaterThan(0);
  });

  it('skips NaN values without crashing', () => {
    const { ctx } = mockCtx();
    const drawn = renderer.render(
      ctx,
      layout,
      vp,
      [series([1, NaN, 3, NaN, 5])],
      300,
      380,
      'nans',
      THEME,
      0,
    );
    expect(drawn).toBe(1);
  });
});

describe('computeLayout — sub-pane reservation', () => {
  it('reserves vertical space for each pane', () => {
    const a = computeLayout(800, 400, 0);
    const b = computeLayout(800, 400, 1);
    const c = computeLayout(800, 400, 2);
    expect(a.chartBottom).toBeGreaterThan(b.chartBottom);
    expect(b.chartBottom).toBeGreaterThan(c.chartBottom);
    expect(b.paneCount).toBe(1);
    expect(c.paneCount).toBe(2);
  });

  it('keeps the main area no smaller than MIN_MAIN_AREA_HEIGHT', () => {
    // Request more panes than fit; height should be clamped.
    const layout = computeLayout(800, 200, 10);
    expect(layout.chartBottom - layout.chartTop).toBeGreaterThanOrEqual(120);
  });

  it('paneAreaTop equals chartBottom; paneAreaBottom is above the time axis', () => {
    const layout = computeLayout(800, 400, 2);
    expect(layout.paneAreaTop).toBe(layout.chartBottom);
    expect(layout.paneAreaBottom).toBe(400 - layout.timeAxisHeight);
  });
});
