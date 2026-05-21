import type { CandleBuffer } from './data/CandleBuffer';

/**
 * A single OHLCV candle. Times are Unix seconds (not milliseconds).
 * Prices and volume are plain finite numbers — runtime validation via
 * `validateCandles` enforces `h >= l`, `h >= max(o,c)`, `l <= min(o,c)`,
 * `v >= 0`, and `t > 0`.
 */
export interface Candle {
  /** Open price. */
  o: number;
  /** High price. */
  h: number;
  /** Low price. */
  l: number;
  /** Close price. */
  c: number;
  /** Volume traded in this interval. */
  v: number;
  /** Unix timestamp in seconds. */
  t: number;
}

/**
 * Zero-copy typed-array view into a contiguous range of candles in the
 * underlying `CandleBuffer`. Renderers consume this shape directly to
 * avoid per-candle object allocation on the hot rendering path.
 */
export interface CandleView {
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  time: Float64Array;
  /** Number of valid candles in this view. */
  length: number;
  /** Index of the first candle in the parent buffer. */
  offset: number;
}

/**
 * Identifier for a live data stream. A `DataTransport.subscribe` call
 * receives one of these to decide what symbol/resolution to tune in to.
 */
export interface DataFeedConfig {
  symbol: string;
  resolution: string;
}

/**
 * Parameters for a `DataTransport.fetchHistory` call. `from` and `to`
 * are Unix seconds and define the inclusive range the caller would
 * like to receive. The transport may return fewer candles if the
 * source has a lookback cap.
 */
export interface HistoryRequest {
  symbol: string;
  resolution: string;
  from: number;
  to: number;
}

/**
 * Interface hosts implement to feed the chart with history + live
 * updates. `@rekurt/ohlcv-core` ships `PollingTransport`,
 * `WebSocketTransport`, and `BinanceWsTransport` as concrete
 * implementations, but custom transports are trivially written — the
 * interface has only four methods.
 *
 * Error handling: both `fetchHistory` and `subscribe` should throw (or
 * reject in the async case) on failure; the chart's `DataFeed`
 * forwards those errors through `ChartConfig.onError` with a
 * structured `ChartError` payload.
 */
export interface DataTransport {
  /** Fetch a historical candle range. Resolve with the candles ASC by time. */
  fetchHistory(req: HistoryRequest): Promise<Candle[]>;
  /** Start a live stream. `onUpdate` is called with new/updated candles. */
  subscribe(config: DataFeedConfig, onUpdate: (candles: Candle[]) => void): void;
  /** Stop a live stream started by `subscribe`. */
  unsubscribe(): void;
  /** Release all resources (close socket, abort fetch, clear timers). */
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
export type ChartType = 'candles' | 'line' | 'area' | 'ohlc' | 'heikinashi';

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

/**
 * Construction-time configuration for an `OHLCVChart`. All fields
 * except `container`, `symbol`, and `resolution` are optional and
 * have sensible defaults.
 *
 * Later lifecycle changes should go through the imperative methods
 * (`setTheme`, `setChartType`, `setIndicatorConfigs`, etc.) rather
 * than rebuilding the config — the chart manages its own state
 * internally.
 */
export interface ChartConfig {
  /** DOM element to mount the three canvas layers into. */
  container: HTMLElement;
  /** Initial symbol identifier passed to the transport. */
  symbol: string;
  /** Initial resolution (e.g. `'1m'`, `'15m'`, `'1H'`, `'1D'`). */
  resolution: string;
  /** Optional live data source. When omitted, feed candles via `setData`. */
  transport?: DataTransport;
  /** Theme mode (`'dark'` / `'light'` / `'auto'`) or explicit colors. */
  theme?: ThemeMode | ThemeColors;
  /** Locale hint for future i18n. Currently unused by core renderers. */
  locale?: string;
  /** Custom price formatter. Default: 2 decimal places. */
  priceFormat?: (price: number) => string;
  /** Custom volume formatter. Default: short K/M/B suffixes. */
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
  /**
   * Bottom of the candle / price area. When sub-pane indicators are
   * present this value sits ABOVE the time axis with one or more
   * indicator panes between it and `paneAreaBottom`.
   */
  chartBottom: number;
  chartLeft: number;
  chartRight: number;
  volumeTop: number;
  volumeBottom: number;
  priceAxisWidth: number;
  timeAxisHeight: number;
  /** Top of the first sub-pane band (== chartBottom). */
  paneAreaTop: number;
  /**
   * Bottom of the last sub-pane band (== height − timeAxisHeight).
   * When no sub-panes are active this equals `chartBottom`.
   */
  paneAreaBottom: number;
  /** Number of pane-placement indicator bands stacked under the main chart. */
  paneCount: number;
}
