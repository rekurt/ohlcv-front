import type { CandleView, ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';
import type { CandleBuffer } from '../data/CandleBuffer';

/** Everything a series needs to paint one frame of the (possibly conflated) view. */
export interface SeriesRenderContext {
  ctx: CanvasRenderingContext2D;
  layout: ChartLayout;
  viewport: Viewport;
  /** The view to draw — already transformed (if any) and possibly conflated. */
  view: CandleView;
  theme: ThemeColors;
}

/** Min/max price a single view entry contributes to autoscale. */
export interface SeriesPriceRange {
  min: number;
  max: number;
}

/**
 * A pluggable primary-series type. Built-ins (candles, line, area, ohlc,
 * heikinashi) implement this, and hosts can `registerSeriesType` their own
 * (footprint, range bars, …) as first-class citizens that participate in
 * autoscale, conflation, and the legend.
 */
export interface SeriesDefinition {
  /** Discriminator stored in state and passed to `setChartType`. */
  readonly type: string;

  /** Paint the view. */
  draw(c: SeriesRenderContext): void;

  /**
   * Min/max price contributed by entry `i` of `view`, so autoscale fits the
   * series correctly. Defaults to the candle's low/high when omitted. When
   * present (or when `transformView` is), autoscale scans the view via this
   * hook instead of the raw buffer (so it can't use the range pyramid).
   */
  priceRange?(view: CandleView, i: number): SeriesPriceRange;

  /**
   * Optional pre-render transform producing a synthetic, index-aligned
   * `CandleView` for the window [start, end) (Heikin-Ashi, custom). The
   * result flows through autoscale → conflation → draw like any view. Must
   * stay index-aligned to the buffer window (one output row per input row).
   */
  transformView?(buffer: CandleBuffer, start: number, end: number): CandleView;
}
