import { CandleRenderer } from '../rendering/CandleRenderer';
import { LineRenderer } from '../rendering/LineRenderer';
import { AreaRenderer } from '../rendering/AreaRenderer';
import { OHLCBarRenderer } from '../rendering/OHLCBarRenderer';
import { BaselineRenderer, type BaselineRenderOptions } from '../rendering/BaselineRenderer';
import { buildHeikinAshiView } from '../rendering/HeikinAshiRenderer';
import type { SeriesDefinition } from './Series';

// Shared renderer instances — stateless, safe to reuse across charts.
const candleRenderer = new CandleRenderer();
const lineRenderer = new LineRenderer();
const areaRenderer = new AreaRenderer();
const ohlcRenderer = new OHLCBarRenderer();
const baselineRenderer = new BaselineRenderer();

export const candleSeries: SeriesDefinition = {
  type: 'candles',
  draw: ({ ctx, layout, viewport, view, theme }) =>
    candleRenderer.render(ctx, layout, viewport, view, theme),
};

export const lineSeries: SeriesDefinition = {
  type: 'line',
  draw: ({ ctx, layout, viewport, view, theme }) =>
    lineRenderer.render(ctx, layout, viewport, view, theme),
};

export const areaSeries: SeriesDefinition = {
  type: 'area',
  draw: ({ ctx, layout, viewport, view, theme }) =>
    areaRenderer.render(ctx, layout, viewport, view, theme),
};

export const ohlcSeries: SeriesDefinition = {
  type: 'ohlc',
  draw: ({ ctx, layout, viewport, view, theme }) =>
    ohlcRenderer.render(ctx, layout, viewport, view, theme),
};

/**
 * Heikin-Ashi as a first-class series: `transformView` builds the synthetic
 * HA view (the seam previously hidden inside HeikinAshiRenderer), and `draw`
 * delegates to the candle renderer. Because the transformed view now flows
 * through autoscale, the price axis fits the HA candles — fixing the prior
 * behavior where it scaled to the raw OHLC instead.
 */
export const heikinAshiSeries: SeriesDefinition = {
  type: 'heikinashi',
  transformView: (buffer, start, end) => buildHeikinAshiView(buffer, start, end),
  draw: ({ ctx, layout, viewport, view, theme }) =>
    candleRenderer.render(ctx, layout, viewport, view, theme),
};

/**
 * Baseline series: close-price area/line drawn in two colors relative to a
 * base value. The built-in instance uses the default base (first visible
 * close); use {@link createBaselineSeries} to pin a fixed base value or
 * override colors.
 */
export const baselineSeries: SeriesDefinition = {
  type: 'baseline',
  draw: ({ ctx, layout, viewport, view, theme }) =>
    baselineRenderer.render(ctx, layout, viewport, view, theme),
};

/**
 * Build a baseline series with a fixed base value and/or custom colors.
 * Register the result via `registerSeriesType` (it overwrites the built-in
 * `'baseline'` unless you pass a distinct `type`).
 *
 * @example
 *   registerSeriesType(createBaselineSeries({ baseValue: 100 }));
 *   chart.setChartType('baseline');
 */
export function createBaselineSeries(
  options: BaselineRenderOptions & { type?: string } = {},
): SeriesDefinition {
  const { type = 'baseline', ...renderOpts } = options;
  return {
    type,
    draw: ({ ctx, layout, viewport, view, theme }) =>
      baselineRenderer.render(ctx, layout, viewport, view, theme, renderOpts),
  };
}

export const BUILTIN_SERIES: readonly SeriesDefinition[] = [
  candleSeries,
  lineSeries,
  areaSeries,
  ohlcSeries,
  heikinAshiSeries,
  baselineSeries,
];
