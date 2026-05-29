import { CandleRenderer } from '../rendering/CandleRenderer';
import { LineRenderer } from '../rendering/LineRenderer';
import { AreaRenderer } from '../rendering/AreaRenderer';
import { OHLCBarRenderer } from '../rendering/OHLCBarRenderer';
import { buildHeikinAshiView } from '../rendering/HeikinAshiRenderer';
import type { SeriesDefinition } from './Series';

// Shared renderer instances — stateless, safe to reuse across charts.
const candleRenderer = new CandleRenderer();
const lineRenderer = new LineRenderer();
const areaRenderer = new AreaRenderer();
const ohlcRenderer = new OHLCBarRenderer();

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

export const BUILTIN_SERIES: readonly SeriesDefinition[] = [
  candleSeries,
  lineSeries,
  areaSeries,
  ohlcSeries,
  heikinAshiSeries,
];
