import type { CandleBuffer } from './data/CandleBuffer';

export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t: number; // unix seconds
}

export interface CandleView {
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  time: Float64Array;
  length: number;
  offset: number; // index offset in the full buffer
}

export interface DataFeedConfig {
  symbol: string;
  resolution: string;
}

export interface HistoryRequest {
  symbol: string;
  resolution: string;
  from: number;
  to: number; // unix seconds
}

export interface DataTransport {
  fetchHistory(req: HistoryRequest): Promise<Candle[]>;
  subscribe(config: DataFeedConfig, onUpdate: (candles: Candle[]) => void): void;
  unsubscribe(): void;
  destroy(): void;
}

export interface ThemeColors {
  background: string;
  bullCandle: string;
  bearCandle: string;
  bullVolume: string;
  bearVolume: string;
  grid: string;
  axis: string;
  text: string;
  crosshair: string;
  priceLine: string;
}

/**
 * Theme selection:
 * - `'dark'` / `'light'` — explicit
 * - `'auto'` — follow `prefers-color-scheme` media query (falls back to
 *   `'dark'` in non-DOM environments)
 */
export type ThemeMode = 'dark' | 'light' | 'auto';

/**
 * Location identifier for an error dispatched through `ChartConfig.onError`.
 * Use this to decide severity and display strategy — e.g. a `fetchHistory`
 * error may block the chart, while a `subscribe` error may just drop one
 * live tick.
 */
export type ChartErrorWhere =
  | 'fetchHistory'
  | 'loadMoreHistory'
  | 'subscribe'
  | 'parseCandles'
  | 'render'
  | 'unknown';

/**
 * Structured error payload dispatched by the chart. Replaces the previous
 * silent `catch {}` behavior so hosts can log, report to Sentry, or display
 * a UI warning.
 */
export interface ChartError {
  /** Where in the chart pipeline the error originated. */
  where: ChartErrorWhere;
  /** The wrapped Error instance (never null; strings are coerced). */
  error: Error;
  /**
   * When true, the chart may be in an unusable state (e.g. initial history
   * fetch failed). When false, the chart continues operating normally
   * (e.g. a single dropped poll cycle).
   */
  fatal: boolean;
}

/**
 * Visual style of the main price series.
 * - `candles` — classic red/green candlesticks (default)
 * - `line` — simple close-price line
 * - `area` — close-price line with a gradient fill to chartBottom
 * - `ohlc` — OHLC bars (vertical line with open/close ticks)
 */
export type ChartType = 'candles' | 'line' | 'area' | 'ohlc';

/**
 * Hover callback payload — invoked by CrosshairController on every
 * snap-to-candle change. Useful for status bars and legends.
 */
export interface HoverInfo {
  candle: Candle;
  index: number;
  /** Raw price under the cursor (before candle snap). */
  cursorPrice: number;
  /** ISO-ish time string formatted by the current resolution. */
  timeLabel: string;
}

export interface ChartConfig {
  container: HTMLElement;
  symbol: string;
  resolution: string;
  transport?: DataTransport;
  theme?: ThemeMode | ThemeColors;
  locale?: string;
  priceFormat?: (price: number) => string;
  volumeFormat?: (volume: number) => string;
  /** Style of the main price series. Default: `'candles'`. */
  chartType?: ChartType;
  onCandleClick?: (candle: Candle, index: number) => void;
  onVisibleRangeChange?: (from: number, to: number) => void;
  /** Called on every crosshair move with the currently-snapped candle. */
  onHover?: (info: HoverInfo | null) => void;
  /**
   * Called whenever the chart encounters a non-fatal or fatal error in its
   * data/render pipeline. If omitted, errors fall back to `console.warn`
   * via the default `ErrorReporter`.
   */
  onError?: (err: ChartError) => void;
  /**
   * Called when the user pans into the left edge of the buffer. Lets hosts
   * implement virtual scroll by fetching older candles and calling
   * `chart.prependHistory(olderCandles)`. The chart serializes calls — only
   * one load-more request is in flight at a time.
   */
  onLoadMoreHistory?: (buffer: CandleBuffer) => void | Promise<void>;
}

export interface ChartLayout {
  width: number;
  height: number;
  chartTop: number;
  chartBottom: number;
  chartLeft: number;
  chartRight: number;
  volumeTop: number;
  volumeBottom: number;
  priceAxisWidth: number;
  timeAxisHeight: number;
}
