import type { CandleBuffer } from './data/CandleBuffer';
import type { PriceScaleMode } from './interaction/priceScale';
import type { HorzScaleBehavior } from './horzscale/HorzScaleBehavior';
import type { Alert } from './alerts/Alert';
import type { Messages } from './i18n/messages';

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
  /**
   * Present only on a conflated (downsampled) view: for each aggregated
   * bucket, the buffer index of its first candle. Renderers position a
   * bucket via `viewport.indexToX(repIndex[i])` instead of `offset + i`.
   * Absent on normal views, so the standard render path is unaffected.
   */
  repIndex?: Int32Array;
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
 * updates. `@rekurt/openkline-core` ships `PollingTransport` and the
 * abstract `WebSocketTransport` base as concrete starting points, but
 * custom transports are trivially written — the interface has only
 * four methods.
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
  | 'indicator'
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
 * - `heikinashi` — smoothed Heikin-Ashi candles
 * - `baseline` — two-color close area/line relative to a base value
 */
export type ChartType = 'candles' | 'line' | 'area' | 'ohlc' | 'heikinashi' | 'baseline';

/**
 * Crosshair behavior.
 * - `normal` — the horizontal line follows the raw cursor Y (default).
 * - `magnet` — the horizontal line snaps to the nearest OHLC level of the
 *   candle under the cursor, matching lightweight-charts' Magnet mode.
 */
export type CrosshairMode = 'normal' | 'magnet';

/**
 * Topmost interactive object under the cursor, reported in {@link HoverInfo}.
 * Lets hosts build context menus, tooltips, or hover highlights without
 * re-running their own hit-tests. `id` is the object's stable identifier:
 * - `drawing` — the `Drawing.id` (random string assigned on creation).
 * - `primitive` — the `Primitive.id` (host-supplied, e.g. `'priceline:0'`).
 * - `marker` — reserved for a future marker hit-test (not yet emitted).
 */
export interface HoveredObject {
  kind: 'drawing' | 'primitive' | 'marker';
  id: string;
}

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
  /** 0 = main price pane; 1..N = indicator sub-panes (top→bottom). */
  paneIndex: number;
  /** Topmost interactive object under the cursor, or null. */
  hovered: HoveredObject | null;
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
  /**
   * BCP-47 locale (e.g. `'de-DE'`, `'ja-JP'`) for i18n (C6). When set, axis
   * numbers/dates, the legend, the crosshair pills, and screen-reader
   * announcements are formatted via `Intl` for this locale. Omit for the
   * locale-agnostic defaults (byte-for-byte identical to pre-C6). A
   * host-supplied `priceFormat` / `volumeFormat` still takes priority over the
   * locale-aware number formatting.
   */
  locale?: string;
  /**
   * Translatable UI string overrides (C6). Patches any subset of
   * {@link Messages} — `aria-label`, the OHLC announcement words, the
   * O/H/L/C/V legend letters, the "Go to live" pill — falling back to the
   * English {@link DEFAULT_MESSAGES} for the rest. Independent of `locale`:
   * you can translate strings without switching number/date formatting, or
   * vice-versa.
   */
  messages?: Partial<Messages>;
  /** Custom price formatter. Default: 2 decimal places. */
  priceFormat?: (price: number) => string;
  /** Custom volume formatter. Default: short K/M/B suffixes. */
  volumeFormat?: (volume: number) => string;
  /** Style of the main price series. Default: `'candles'`. */
  chartType?: ChartType;
  /** Crosshair mode (`'normal'` / `'magnet'`). Default: `'normal'`. */
  crosshairMode?: CrosshairMode;
  /** Initial price-axis scale mode. Default: `'linear'`. */
  priceScaleMode?: PriceScaleMode;
  /**
   * Horizontal-domain behavior controlling X-axis labels (time / price /
   * custom). Default: time. Use `PriceScaleBehavior` for options-style
   * numeric (strike) axes.
   */
  horzScale?: HorzScaleBehavior;
  onCandleClick?: (candle: Candle, index: number) => void;
  onVisibleRangeChange?: (from: number, to: number) => void;
  /** Called on every crosshair move with the currently-snapped candle. */
  onHover?: (info: HoverInfo | null) => void;
  /**
   * Called on a double-click over the plot area with the `HoverInfo` for
   * the cursor position (or `null` if the cursor is outside the plot). This
   * is purely additive — the chart's built-in double-click behavior
   * (fit-visible in the chart area, reset price scale over the axis) still
   * runs independently.
   */
  onDblClick?: (info: HoverInfo | null) => void;
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
  /**
   * Cap on the number of candles retained in the buffer. When live updates
   * push the length past this, the oldest candles are evicted (O(1)) and
   * the viewport + drawings shift to stay anchored to the same candles.
   * Bounds memory for long-running live charts. Omit for unlimited.
   * History prepended via `prependHistory` is never auto-evicted.
   *
   * Eviction is suspended while a replay session is active (the replay cap is
   * an absolute index that head-eviction would desync), so the buffer may
   * temporarily exceed `maxCandles` during a long replay and is trimmed back
   * on the first live append after `stopReplay()`.
   */
  maxCandles?: number;
  /**
   * Called on every replay-mode (C1) index change with the last-revealed bar
   * index and whether playback is running. Fires on `startReplay`,
   * `stepReplay`, `seekReplay`, each play tick, and `stopReplay`. Use it to
   * drive a scrubber / play-pause UI. Omit if you don't use replay mode.
   */
  onReplayChange?: (index: number, playing: boolean) => void;
  /**
   * Called once for each price alert (C3) that fires on a realtime close-price
   * tick. The alert is one-shot — it is already `active: false` when this
   * callback runs, so it won't fire again until re-armed. Use it to surface a
   * toast/sound/notification. Add alerts via `chart.addAlert(...)`.
   */
  onAlert?: (alert: Alert) => void;
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
  /**
   * Width (px) reserved on the LEFT for the optional secondary price axis
   * (B2). `0` when no indicator is bound to the left scale — in that case
   * `chartLeft` stays at 0 and the layout/render is identical to before.
   * When > 0, `chartLeft` is shifted right by this much to make room.
   */
  leftAxisWidth: number;
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
