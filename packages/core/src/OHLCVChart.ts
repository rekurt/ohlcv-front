import type { Candle, CandleView, ChartConfig, ChartType, CrosshairMode, ThemeColors, ThemeMode, HoverInfo } from './types';
import type { PriceScaleMode } from './interaction/priceScale';
import type { HorzScaleBehavior } from './horzscale/HorzScaleBehavior';
import { resolveTheme } from './utils';
import { ErrorReporter } from './ErrorReporter';
import { CandleBuffer } from './data/CandleBuffer';
import { CandleMerger } from './data/CandleMerger';
import { DataFeed } from './data/DataFeed';
import { ValidationError, validateCandles } from './data/validation';
import { ChartEngine } from './rendering/ChartEngine';
import { createI18n, type Messages } from './i18n/messages';
import { Viewport } from './interaction/Viewport';
import { PanZoomController } from './interaction/PanZoomController';
import { CrosshairController } from './interaction/CrosshairController';
import { KeyboardController } from './interaction/KeyboardController';
import { ReplayController } from './interaction/ReplayController';
import type { Indicator } from './indicators/Indicator';
import { createIndicator, type IndicatorConfig } from './indicators/registry';
import { DrawingLayer } from './drawings/DrawingLayer';
import { TrendLine } from './drawings/TrendLine';
import { HorizontalLine } from './drawings/HorizontalLine';
import { Rectangle } from './drawings/Rectangle';
import { Ray } from './drawings/Ray';
import { VerticalLine } from './drawings/VerticalLine';
import { FibRetracement } from './drawings/FibRetracement';
import { FibExtension } from './drawings/FibExtension';
import { Channel } from './drawings/Channel';
import { Arrow } from './drawings/Arrow';
import { ParallelChannel } from './drawings/ParallelChannel';
import { RegressionChannel } from './drawings/RegressionChannel';
import { Pitchfork } from './drawings/Pitchfork';
import { FibFan } from './drawings/FibFan';
import { Measure } from './drawings/Measure';
import type { DrawingSnapshot } from './drawings/Drawing';
import type { Marker } from './markers/Marker';
import type { SeriesDefinition } from './series/Series';
import { registerSeriesType as registerSeriesTypeImpl } from './series/registry';
import type { Primitive } from './primitives/Primitive';
import { WatermarkPrimitive, type WatermarkOptions } from './primitives/WatermarkPrimitive';
import {
  PriceLinePrimitive,
  type PriceLineOptions,
  type PriceLineHandle,
} from './primitives/PriceLinePrimitive';
import { AlertManager } from './alerts/AlertManager';
import type { Alert, AlertInit } from './alerts/Alert';
import type { LayoutState, FullState, ChartState } from './state/ChartState';

/** Stable primitive id for the single host-managed watermark. */
const WATERMARK_ID = 'ohlcv:watermark';

/** Primitive-id prefix for the price line that visualizes an active alert. */
const ALERT_LINE_PREFIX = 'alert:';
/** Dashed line color for alert price lines (amber — distinct from price lines). */
const ALERT_LINE_COLOR = '#f5a623';
import { isFullState } from './state/ChartState';
import { migrateState } from './state/migrations';

/**
 * High-level facade over the chart engine + data feed + interaction
 * controllers. This is the single class you instantiate to put a
 * working OHLCV chart on the page when using the core package
 * directly — React and Vue wrappers construct this internally.
 *
 * Lifecycle:
 *   const chart = new OHLCVChart({ container, symbol, resolution });
 *   chart.setData(candles);                  // or rely on transport
 *   chart.setChartType('line');
 *   chart.setIndicatorConfigs([{ type: 'sma', period: 20 }]);
 *   // ... user interacts ...
 *   chart.destroy();
 *
 * Imperative navigation: `goToLive`, `fitVisible`, `fitAll`,
 * `prependHistory`, `updateLastCandle`.
 *
 * State persistence: `saveLayoutState`, `saveFullState`, `loadState`.
 *
 * Safety: `destroy()` is idempotent. Errors in the data pipeline are
 * dispatched through `ChartConfig.onError` instead of being
 * silently swallowed.
 */

/**
 * Drawing tool identifiers accepted by {@link OHLCVChart.startDrawing}.
 * Exported so the React/Vue wrappers share a single source of truth.
 */
export type DrawingTool =
  | 'trendline'
  | 'hline'
  | 'vline'
  | 'rectangle'
  | 'ray'
  | 'fib'
  | 'fibext'
  | 'channel'
  | 'arrow'
  | 'parallelchannel'
  | 'regression'
  | 'pitchfork'
  | 'fibfan'
  | 'measure';

export class OHLCVChart {
  private _buffer: CandleBuffer;
  private _merger: CandleMerger;
  private _dataFeed: DataFeed;
  private _engine: ChartEngine;
  private _panZoom: PanZoomController;
  private _crosshair: CrosshairController;
  private _keyboard: KeyboardController;
  /**
   * Bar-by-bar replay driver (C1). Created lazily on the first `startReplay`
   * (or any other replay method) so a chart that never uses replay pays
   * nothing. Cleared by `destroy`.
   */
  private _replay: ReplayController | null = null;
  private _reporter: ErrorReporter;
  private _config: ChartConfig;
  private _clickHandler: ((e: MouseEvent) => void) | null = null;
  private _dblClickHandler: ((e: MouseEvent) => void) | null = null;
  private _loadingMore = false;
  /**
   * Mirror of the most recent `IndicatorConfig[]` passed through
   * `setIndicatorConfigs`. Needed because `saveLayoutState` must return
   * JSON-serializable configs, not `Indicator` class instances. Stays
   * empty when the host uses the legacy `setIndicators(Indicator[])`
   * API with hand-constructed instances.
   */
  private _indicatorConfigs: IndicatorConfig[] = [];
  /**
   * Drawing layer created and managed by the chart itself. Hosts can
   * either let this auto-manage (`startDrawing`, `getDrawings`) or
   * override with a custom layer via `setDrawingLayer(customLayer)` for
   * advanced use.
   */
  private _ownDrawingLayer: DrawingLayer;
  private _priceLineSeq = 0;
  /** Set after a price-line drag so the trailing click doesn't fire onCandleClick. */
  private _suppressNextClick = false;
  /**
   * Price-alert collection (C3). Evaluated on each realtime close-price step
   * in the merger callback; active alerts are mirrored to dashed price lines
   * (primitive id `alert:<id>`).
   */
  private _alerts = new AlertManager();
  /**
   * Last close price seen by the alert evaluator, or null before the first
   * realtime tick. Used as `prevPrice` for `AlertManager.check`; the very
   * first tick has no previous close so the check is skipped (no spurious
   * fire on initial data arrival).
   */
  private _lastAlertClose: number | null = null;

  constructor(config: ChartConfig) {
    // The chart manipulates the DOM and canvas directly, so it can only be
    // constructed in a browser environment. In SSR frameworks (Next.js,
    // Nuxt), construct it on the client only — e.g. a `useEffect`/`onMounted`
    // hook, `next/dynamic` with `{ ssr: false }`, or Nuxt `<client-only>`.
    if (typeof document === 'undefined') {
      throw new Error(
        '[ohlcv] OHLCVChart requires a browser environment (document is undefined). ' +
          'Construct it on the client only — see the SSR notes in the README.',
      );
    }

    this._config = config;
    const theme = resolveTheme(config.theme);
    this._reporter = new ErrorReporter(config.onError);

    // Data layer — pass the reporter so transport/fetch errors get dispatched
    // through `onError` instead of being silently swallowed.
    this._buffer = new CandleBuffer();
    this._merger = new CandleMerger(this._buffer);
    this._dataFeed = new DataFeed(
      this._buffer,
      this._merger,
      config.transport ?? null,
      this._reporter,
    );

    // Rendering
    this._engine = new ChartEngine(config.container, theme);
    this._engine.setErrorReporter(this._reporter);
    this._engine.setBuffer(this._buffer);
    this._engine.setSymbol(config.symbol);
    this._engine.setResolution(config.resolution);
    // i18n (C6): build the localization bundle only when the host opts in
    // (a `locale` or `messages` override). Without either, the engine keeps
    // its default no-locale bundle, so the render path stays byte-for-byte
    // identical to pre-C6. Installed after setResolution so localized
    // time-axis labels use the right resolution bucket.
    if (config.locale !== undefined || config.messages !== undefined) {
      this._engine.setI18n(createI18n(config.locale, config.messages));
    }
    if (config.priceFormat) this._engine.setPriceFormat(config.priceFormat);
    if (config.volumeFormat) this._engine.setVolumeFormat(config.volumeFormat);
    if (config.chartType) this._engine.setChartType(config.chartType);
    if (config.priceScaleMode) this._engine.viewport.setScaleMode(config.priceScaleMode);
    if (config.horzScale) this._engine.setHorzScale(config.horzScale);
    config.container.style.backgroundColor = theme.background;

    // Auto-managed drawing layer. Hosts that need a custom layer can
    // still call `setDrawingLayer` to override — that path bypasses the
    // auto-managed instance and the `startDrawing` convenience methods
    // then no-op until a new layer is attached.
    this._ownDrawingLayer = new DrawingLayer();
    this._engine.setDrawingLayer(this._ownDrawingLayer);

    // Merger triggers render. Only scroll to the live edge if the user is
    // actively following the stream; otherwise just repaint and let the
    // viewport stay wherever the user has scrolled.
    this._merger.onUpdate((info) => {
      const vp = this._engine.viewport;
      // Only evict on realtime appends — never after a loadHistory/prepend,
      // which would immediately drop the page the user just paged in.
      if (info.realtime) this._enforceMaxCandles();
      if (vp.autoFollow || this._buffer.length <= vp.visibleCount) {
        vp.scrollToEnd(this._buffer.length);
      }
      // Price alerts (C3): evaluate the close-price step on realtime frames.
      // A history-load frame (realtime=false) only refreshes the baseline so
      // the next live tick has a correct `prev`, but never fires an alert.
      this._evaluateAlerts(info.realtime);
      this._engine.requestRender();
    });

    // Interaction
    this._panZoom = new PanZoomController(this._engine.topCanvas, this._engine.viewport, {
      onViewportChange: () => {
        this._engine.requestRender();
        if (config.onVisibleRangeChange) {
          const vp = this._engine.viewport;
          const startIdx = Math.max(0, Math.floor(vp.startIndex));
          const endIdx = Math.min(this._buffer.length - 1, Math.ceil(vp.startIndex + vp.visibleCount));
          const startCandle = this._buffer.candleAt(startIdx);
          const endCandle = this._buffer.candleAt(endIdx);
          if (startCandle && endCandle) {
            config.onVisibleRangeChange(startCandle.t, endCandle.t);
          }
        }
        // Virtual scroll: when the user pans into the left edge, dispatch
        // a load-more request through the callback (if configured).
        if (config.onLoadMoreHistory) {
          const vp = this._engine.viewport;
          if (vp.startIndex <= 0 && !this._loadingMore) {
            this._loadingMore = true;
            void Promise.resolve(config.onLoadMoreHistory(this._buffer)).finally(() => {
              this._loadingMore = false;
            });
          }
        }
      },
      onPanToStart: () => {
        this._dataFeed.loadMoreHistory();
      },
      // Route the idle cursor through the engine so drawing tools can
      // override it via `OHLCVChart.setIdleCursor`.
      getIdleCursor: () => this._engine.idleCursor,
      onDragStateChange: (dragging) => this._engine._setActivelyDragging(dragging),
      // Draggable price lines: grab the topmost draggable line under the
      // cursor, then move it with the cursor's price on each drag step.
      hitTestDraggable: (x, y) => {
        const hit = this._engine.hitTestPrimitives(x, y);
        if (hit instanceof PriceLinePrimitive && hit.draggable) return { id: hit.id };
        return null;
      },
      onDragDraggable: (id, price) => {
        // Resolve the line from the engine's primitives (not a private map),
        // so lines attached directly via attachPrimitive() are draggable too,
        // not only those created through createPriceLine().
        const p = this._engine.primitives.find((pr) => pr.id === id);
        if (p instanceof PriceLinePrimitive) {
          p.setPrice(price);
          this._engine.requestRender();
        }
      },
      onDragDraggableEnd: () => {
        // Swallow the click that fires right after the drag so we don't
        // also dispatch onCandleClick for the same gesture.
        this._suppressNextClick = true;
      },
    });
    // Track pending load-more-history calls so we don't fire them faster
    // than they resolve.
    this._loadingMore = false;

    this._crosshair = new CrosshairController(this._engine, this._buffer);
    if (config.onHover) {
      this._onHover = config.onHover;
      this._crosshair.setOnHover(config.onHover);
    }
    if (config.onDblClick) {
      this._crosshair.setOnDblClick(config.onDblClick);
    }
    if (config.crosshairMode) {
      this._crosshair.setMode(config.crosshairMode);
    }

    // Keyboard shortcuts
    this._keyboard = new KeyboardController(
      this._engine.topCanvas,
      this._engine.viewport,
      this._buffer,
      {
        onViewportChange: () => this._engine.requestRender(),
        onGoToLive: () => this.goToLive(),
        onFitVisible: () => this.fitVisible(),
        onFitAll: () => this.fitAll(),
      },
    );

    // Click handler: first check the "Go to live" pill (if visible), then
    // the candle click callback.
    this._clickHandler = (e: MouseEvent) => {
      // A click that immediately follows a price-line drag should not also
      // fire onCandleClick.
      if (this._suppressNextClick) {
        this._suppressNextClick = false;
        return;
      }

      const rect = this._engine.topCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Hit-test the floating pill first — it sits on top of the chart area.
      if (this._engine.goToLiveRenderer.hitTest(x, y)) {
        this.goToLive();
        return;
      }

      if (config.onCandleClick) {
        const layout = this._engine.layout;
        if (x < layout.chartLeft || x > layout.chartRight || y < layout.chartTop || y > layout.chartBottom) return;
        const index = this._engine.viewport.xToIndex(x);
        const candle = this._buffer.candleAt(index);
        if (candle) {
          config.onCandleClick(candle, index);
        }
      }
    };
    this._engine.topCanvas.addEventListener('click', this._clickHandler);

    // Double-click → context-sensitive reset:
    //  - in the chart area: fit visible (reset zoom + go to live)
    //  - in the price axis strip: reset price scale to auto-fit
    this._dblClickHandler = (e: MouseEvent) => {
      const rect = this._engine.topCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const layout = this._engine.layout;
      if (y < layout.chartTop || y > layout.chartBottom) return;
      if (x >= layout.chartRight && x <= layout.chartRight + layout.priceAxisWidth) {
        this._engine.viewport.resetPriceScale();
        this._engine.requestRender();
        return;
      }
      if (x < layout.chartLeft || x > layout.chartRight) return;
      this.fitVisible();
    };
    this._engine.topCanvas.addEventListener('dblclick', this._dblClickHandler);

    // Initial connect if transport is provided
    if (config.transport) {
      this._dataFeed.connect({ symbol: config.symbol, resolution: config.resolution });
    }
  }

  /**
   * Set data directly (without transport).
   *
   * By default, fully resets the buffer and scrolls the viewport to the
   * live edge — the correct behavior when the user has just switched
   * symbols or timeframes.
   *
   * Pass `{ preserveView: true }` to keep the viewport's current
   * `startIndex`, `candleWidth`, and `autoFollow` state. This is what
   * framework wrappers (React/Vue) want when they re-dispatch the same
   * data array as a prop change: the user's pan/zoom position should
   * not jump to the right edge every time React re-renders.
   */
  setData(candles: Candle[], opts?: { preserveView?: boolean }): void {
    const vp = this._engine.viewport;
    const previousStart = vp.startIndex;
    const previousWidth = vp.candleWidth;
    const previousAutoFollow = vp.autoFollow;

    this._buffer.clear();
    this._merger.loadHistory(candles);
    this._enforceMaxCandles();

    if (opts?.preserveView) {
      vp.candleWidth = previousWidth;
      vp.startIndex = previousStart;
      vp.autoFollow = previousAutoFollow;
      // Recalc visible window for the (possibly different) buffer length.
      vp.setLayout(vp.layout);
      // Only auto-scroll if autoFollow was on and buffer length actually grew.
      if (previousAutoFollow) {
        vp.scrollToEnd(this._buffer.length);
      }
    } else {
      vp.scrollToEnd(this._buffer.length);
    }
    this._engine.requestRender();
  }

  /** Update the last (forming) candle */
  updateLastCandle(candle: Candle): void {
    this._merger.mergeRealtime([candle]);
  }

  /**
   * Evict oldest candles past `config.maxCandles`, keeping the viewport and
   * drawings anchored to the same candles (eviction lowers every remaining
   * candle's logical index by the evicted count). No-op when uncapped.
   */
  private _enforceMaxCandles(): void {
    const max = this._config.maxCandles;
    if (max === undefined || max <= 0) return;
    const over = this._buffer.length - max;
    if (over <= 0) return;
    const evicted = this._buffer.evictHead(over);
    if (evicted <= 0) return;
    const vp = this._engine.viewport;
    vp.startIndex = Math.max(0, vp.startIndex - evicted);
    // Shift the layer the engine is actually rendering (a host may have
    // swapped in a custom one via setDrawingLayer), not just the
    // auto-managed instance, so drawings stay pinned to their candles.
    this._engine.drawingLayer?.shiftIndices(-evicted);
  }

  /** Switch to a different symbol/resolution */
  async switchSymbol(symbol: string, resolution: string): Promise<void> {
    this._config.symbol = symbol;
    this._config.resolution = resolution;
    this._engine.setSymbol(symbol);
    this._engine.setResolution(resolution);
    await this._dataFeed.connect({ symbol, resolution });
  }

  /** Change the theme at runtime */
  setTheme(theme: ThemeMode | ThemeColors): void {
    const resolved = resolveTheme(theme);
    this._engine.setTheme(resolved);
  }

  /**
   * Switch localization at runtime (C6): rebuilds the i18n bundle from the
   * given BCP-47 `locale` (or `undefined` for the locale-agnostic defaults)
   * and optional `messages` overrides, updating the `aria-label`, axis
   * number/date formatting, legend, and pills, then repaints. Pass no args to
   * reset to the English, locale-agnostic baseline.
   */
  setLocale(locale?: string, messages?: Partial<Messages>): void {
    this._config.locale = locale;
    if (messages !== undefined) this._config.messages = messages;
    this._engine.setI18n(createI18n(locale, messages ?? this._config.messages));
  }

  /** Get the underlying buffer */
  getBuffer(): CandleBuffer {
    return this._buffer;
  }

  /** Get the viewport */
  getViewport(): Viewport {
    return this._engine.viewport;
  }

  /**
   * Zero-copy view over the candles currently in the visible window
   * (excludes the +1 render-only bar). Returns `null` when there is no data
   * or the window is empty. Primarily the data seam an optional, attach-only
   * overlay (C4 Volume Profile via `VolumeProfileController`) reads through —
   * delegates to {@link ChartEngine.visibleCandleView}.
   */
  visibleCandleView(): CandleView | null {
    return this._engine.visibleCandleView();
  }

  /** Force a render */
  render(): void {
    this._engine.requestRender();
  }

  /** Scroll to the live edge and resume following new candles. */
  goToLive(): void {
    this._engine.viewport.goToLive(this._buffer.length);
    this._engine.requestRender();
  }

  /** Reset zoom to the default candleWidth and go to live. */
  fitVisible(): void {
    this._engine.viewport.fitVisible(this._buffer.length);
    this._engine.requestRender();
  }

  /** Zoom out so the entire buffer is visible at once, from the start. */
  fitAll(): void {
    this._engine.viewport.fitAll(this._buffer.length);
    this._engine.requestRender();
  }

  /**
   * Lazily create (once) and return the replay controller. Wires the
   * `onReplayChange` config callback through on first use.
   */
  private _ensureReplay(): ReplayController {
    if (!this._replay) {
      this._replay = new ReplayController(this._engine, this._buffer, {
        onChange: this._config.onReplayChange,
      });
    }
    return this._replay;
  }

  /**
   * Enter bar-by-bar replay mode (C1), revealing history up to `fromIndex`
   * (default 0 — start from the first bar). The chart then shows only the
   * revealed prefix; advance with {@link playReplay}/{@link stepReplay} or
   * jump with {@link seekReplay}. Leave replay with {@link stopReplay}.
   */
  startReplay(fromIndex?: number): void {
    this._ensureReplay().start(fromIndex);
  }

  /** Begin/resume automatic replay playback. No-op until {@link startReplay}. */
  playReplay(): void {
    this._ensureReplay().play();
  }

  /** Pause automatic replay playback. */
  pauseReplay(): void {
    this._ensureReplay().pause();
  }

  /** Reveal/hide one replay bar (`forward` default true). */
  stepReplay(forward?: boolean): void {
    this._ensureReplay().step(forward);
  }

  /** Jump replay to a specific bar index (clamped into range). */
  seekReplay(index: number): void {
    this._ensureReplay().seek(index);
  }

  /** Set replay playback speed in bars per second. */
  setReplaySpeed(bps: number): void {
    this._ensureReplay().setSpeed(bps);
  }

  /**
   * Leave replay mode: clears the virtual buffer cap so the full buffer
   * renders again, stops playback, and repaints. Safe to call when not in
   * replay (no-ops the cap clear).
   */
  stopReplay(): void {
    // Only create the controller if one exists or replay was used; if it was
    // never started, there's nothing to stop — but routing through the lazy
    // getter keeps the cap-clear + render idempotent and cheap.
    this._ensureReplay().stop();
  }

  /** True while replay mode is engaged (a virtual buffer cap is active). */
  isReplaying(): boolean {
    return this._replay?.active ?? false;
  }

  /** Switch the primary price-series rendering style (built-in or custom). */
  setChartType(chartType: ChartType | (string & {})): void {
    this._engine.setChartType(chartType);
  }

  /**
   * Register a custom primary-series type as a first-class citizen — it
   * participates in autoscale (via its `priceRange`), conflation, and the
   * crosshair. Use `setChartType(def.type)` to activate it. Register before
   * `loadState` if a saved chart references the custom type (otherwise the
   * load falls back to candles at render time).
   */
  registerSeriesType(def: SeriesDefinition): void {
    registerSeriesTypeImpl(def);
    if (this._engine.chartType === def.type) this._engine.requestRender();
  }

  /**
   * Switch the price-axis scale mode:
   *  - `'linear'` — equal price deltas are equal pixel deltas (default)
   *  - `'log'` — equal *ratios* are equal pixel deltas (BTC-over-years)
   *  - `'percentage'` — axis reads % change vs. the first visible candle
   *  - `'indexedTo100'` — first visible candle anchored at 100
   *
   * Clears any manual (dragged) price scale so the new mode auto-fits.
   */
  setPriceScaleMode(mode: PriceScaleMode): void {
    this._engine.viewport.setScaleMode(mode);
    this._engine.requestRender();
  }

  /** Read the current price-axis scale mode. */
  getPriceScaleMode(): PriceScaleMode {
    return this._engine.viewport.scaleMode;
  }

  /**
   * Replace the horizontal-scale behavior, controlling how the X axis is
   * labeled — time (default), price/strike (options charts), or custom.
   * Note: the crosshair X-label still uses the time formatter for now.
   */
  setHorzScale(behavior: HorzScaleBehavior): void {
    this._engine.setHorzScale(behavior);
  }

  /**
   * Replace the indicator set on the chart with pre-constructed instances.
   *
   * Advanced use only — most hosts should call `setIndicatorConfigs`
   * instead so the chart can serialize the indicators through
   * `saveLayoutState`. Calling this method clears the internal
   * `IndicatorConfig[]` mirror, so subsequent `saveLayoutState` calls
   * will return `indicators: []` even though the chart is still
   * rendering them.
   */
  setIndicators(indicators: Indicator[]): void {
    this._indicatorConfigs = [];
    this._engine.setIndicators(indicators);
  }

  /**
   * Replace the indicator set using declarative configs. This is the
   * recommended path for React/Vue wrappers: the chart remembers the
   * configs so `saveLayoutState()` can round-trip them without the
   * wrapper having to track indicators out-of-band.
   */
  setIndicatorConfigs(configs: IndicatorConfig[]): void {
    this._indicatorConfigs = configs.slice();
    this._engine.setIndicators(configs.map(createIndicator));
  }

  /** Read the indicator set currently rendering. */
  getIndicators(): readonly Indicator[] {
    return this._engine.indicators;
  }

  /**
   * Read the indicator configs last passed through `setIndicatorConfigs`.
   * Returns an empty array if the host used the legacy
   * `setIndicators(Indicator[])` path — in that case the chart has no
   * way to reverse-engineer configs from arbitrary Indicator subclasses.
   */
  getIndicatorConfigs(): readonly IndicatorConfig[] {
    return this._indicatorConfigs;
  }

  /** Attach (or clear) a drawing layer rendered above the price series. */
  setDrawingLayer(layer: DrawingLayer | null): void {
    this._engine.setDrawingLayer(layer);
  }

  /**
   * Access the chart's auto-managed DrawingLayer. Returns the same
   * instance that `startDrawing` / `getDrawings` / `loadDrawings`
   * operate on, unless the host replaced it via `setDrawingLayer`.
   */
  getDrawingLayer(): DrawingLayer {
    return this._ownDrawingLayer;
  }

  /**
   * Begin an interactive drawing workflow. The next `click` event
   * routed through the host's click handler should call
   * `drawingLayer.addPoint({ index, price })`. When the drawing
   * completes (enough anchors), it is finalized automatically.
   *
   * Supported tools (see {@link DrawingTool}):
   *  - `trendline` (2 points)
   *  - `hline` (1 point — horizontal price line)
   *  - `vline` (1 point — vertical index line)
   *  - `rectangle` (2 points — diagonal corners)
   *  - `ray` (2 points — semi-infinite line)
   *  - `fib` (2 points — Fibonacci retracement levels)
   *  - `fibext` (3 points — Fibonacci extension targets)
   *  - `channel` (3 points — equidistant channel)
   *  - `arrow` (2 points — arrow segment)
   *  - `parallelchannel` (3 points — bounded parallel channel)
   *  - `regression` (2 points — least-squares channel ±2σ over the span)
   *  - `pitchfork` (3 points — Andrews' pitchfork)
   *  - `fibfan` (2 points — Fibonacci fan rays)
   *  - `measure` (2 points — price/percent/bar ruler)
   */
  startDrawing(tool: DrawingTool): void {
    switch (tool) {
      case 'trendline':
        this._ownDrawingLayer.startDrawing(new TrendLine());
        return;
      case 'hline':
        this._ownDrawingLayer.startDrawing(new HorizontalLine());
        return;
      case 'vline':
        this._ownDrawingLayer.startDrawing(new VerticalLine());
        return;
      case 'rectangle':
        this._ownDrawingLayer.startDrawing(new Rectangle());
        return;
      case 'ray':
        this._ownDrawingLayer.startDrawing(new Ray());
        return;
      case 'fib':
        this._ownDrawingLayer.startDrawing(new FibRetracement());
        return;
      case 'fibext':
        this._ownDrawingLayer.startDrawing(new FibExtension());
        return;
      case 'channel':
        this._ownDrawingLayer.startDrawing(new Channel());
        return;
      case 'arrow':
        this._ownDrawingLayer.startDrawing(new Arrow());
        return;
      case 'parallelchannel':
        this._ownDrawingLayer.startDrawing(new ParallelChannel());
        return;
      case 'regression': {
        const channel = new RegressionChannel();
        // The regression fit needs the `close` series of its index span,
        // which the render path can't reach (Drawing.render has no buffer
        // by design). Hand the drawing a sampler bound to this chart's
        // buffer; it pulls the closes once on first complete render and
        // caches them (and they then persist in the snapshot's `data`).
        channel.setSampler((start, end) => this._sampleCloses(start, end));
        this._ownDrawingLayer.startDrawing(channel);
        return;
      }
      case 'pitchfork':
        this._ownDrawingLayer.startDrawing(new Pitchfork());
        return;
      case 'fibfan':
        this._ownDrawingLayer.startDrawing(new FibFan());
        return;
      case 'measure':
        this._ownDrawingLayer.startDrawing(new Measure());
        return;
    }
  }

  /**
   * Read the `close` series for the inclusive buffer-index span
   * `[start, end]`, clamped to the loaded buffer. Returned array is
   * ordered oldest→newest with `result[0]` at buffer index `start`
   * (positions outside the loaded range are skipped, so a partially
   * loaded span still yields a usable fit). Backs the regression
   * channel's {@link CloseSampler}.
   */
  private _sampleCloses(start: number, end: number): number[] {
    const lo = Math.round(Math.min(start, end));
    const hi = Math.round(Math.max(start, end));
    const out: number[] = [];
    for (let i = lo; i <= hi; i++) {
      const candle = this._buffer.candleAt(i);
      if (candle) out.push(candle.c);
    }
    return out;
  }

  /** Serialize the auto-managed drawing layer to a snapshot array. */
  getDrawings(): DrawingSnapshot[] {
    return this._ownDrawingLayer.toSnapshot();
  }

  /**
   * Replace all drawings with a fresh snapshot list. Unknown drawing
   * kinds are silently skipped (same semantics as
   * `DrawingLayer.fromSnapshot`).
   */
  loadDrawings(snapshots: DrawingSnapshot[]): void {
    const layer = DrawingLayer.fromSnapshot(snapshots);
    this._ownDrawingLayer = layer;
    this._engine.setDrawingLayer(layer);
    this._engine.requestRender();
  }

  /** Remove every drawing from the auto-managed layer. */
  clearDrawings(): void {
    this._ownDrawingLayer.clear();
    this._ownDrawingLayer.cancelActive();
    this._engine.requestRender();
  }

  /**
   * Hit-test the auto-managed drawings at a canvas point (in CSS pixels
   * relative to the chart container) and select the topmost match — or
   * clear the selection if nothing is hit. Returns the selected drawing's
   * id, or null. Wire this to a `click`/`pointerdown` handler.
   */
  selectDrawingAt(x: number, y: number, tolerance?: number): string | null {
    const hit = this._ownDrawingLayer.selectAt(
      x,
      y,
      this._engine.layout,
      this._engine.viewport,
      tolerance,
    );
    this._engine.requestRender();
    return hit ? hit.id : null;
  }

  /** Id of the currently-selected drawing, or null. */
  getSelectedDrawingId(): string | null {
    return this._ownDrawingLayer.selectedId;
  }

  /** Select a drawing by id, or clear the selection with null. */
  selectDrawing(id: string | null): void {
    this._ownDrawingLayer.select(id);
    this._engine.requestRender();
  }

  /** Delete the selected drawing, if any. Returns true if one was removed. */
  deleteSelectedDrawing(): boolean {
    const removed = this._ownDrawingLayer.removeSelected();
    if (removed) this._engine.requestRender();
    return removed;
  }

  /** Undo the last drawing add/remove/clear. Returns true if applied. */
  undoDrawing(): boolean {
    const applied = this._ownDrawingLayer.undo();
    if (applied) this._engine.requestRender();
    return applied;
  }

  /**
   * Replace all candle-anchored markers (buy/sell arrows, event flags).
   * Markers are pinned by `time`, so they survive history loads and
   * `maxCandles` eviction. Markers are runtime annotations — they are not
   * included in `saveLayoutState`; persist them yourself if needed.
   */
  setMarkers(markers: Marker[]): void {
    this._engine.setMarkers(markers.slice());
  }

  /** The current markers, in draw order. */
  getMarkers(): readonly Marker[] {
    return this._engine.markers;
  }

  /** Append a single marker. */
  addMarker(marker: Marker): void {
    this._engine.setMarkers([...this._engine.markers, marker]);
  }

  /** Remove a marker by id. Returns true if one was removed. */
  removeMarker(id: string): boolean {
    const next = this._engine.markers.filter((m) => m.id !== id);
    if (next.length === this._engine.markers.length) return false;
    this._engine.setMarkers(next);
    return true;
  }

  /** Remove all markers. */
  clearMarkers(): void {
    this._engine.setMarkers([]);
  }

  /**
   * Attach a programmatic overlay primitive (watermark, price line, custom
   * band) rendered at its z-tier. Primitives are runtime annotations — they
   * are not included in `saveLayoutState`.
   */
  attachPrimitive(primitive: Primitive): void {
    this._engine.attachPrimitive(primitive);
  }

  /** Detach a primitive by id. Returns true if one was removed. */
  detachPrimitive(id: string): boolean {
    return this._engine.detachPrimitive(id);
  }

  /** The attached primitives, in attach order. */
  getPrimitives(): readonly Primitive[] {
    return this._engine.primitives;
  }

  /**
   * Set (or replace) a faint background watermark — text (symbol/timeframe)
   * or an image (logo), painted behind the grid and series. Runtime-only;
   * not included in `saveLayoutState`.
   */
  setWatermark(options: WatermarkOptions): void {
    this._engine.detachPrimitive(WATERMARK_ID);
    this._engine.attachPrimitive(new WatermarkPrimitive(WATERMARK_ID, options));
    // An image passed before it finished loading draws nothing on the single
    // attach-render, and nothing later marks the chart dirty — so repaint once
    // it loads, otherwise a static chart never shows the image watermark.
    const img = options.image as HTMLImageElement | undefined;
    if (img && typeof img.addEventListener === 'function' && img.complete === false) {
      img.addEventListener(
        'load',
        () => {
          if (!this._destroyed) this._engine.requestRender();
        },
        { once: true },
      );
    }
  }

  /** Remove the watermark, if one is set. */
  clearWatermark(): void {
    this._engine.detachPrimitive(WATERMARK_ID);
  }

  /**
   * Create a horizontal price line at a fixed price, with a right-axis label
   * pill, optionally draggable. Returns a handle to move/restyle/remove it.
   * Correct under any price-scale mode (positions via the viewport). Price
   * lines are runtime-only — not included in `saveLayoutState`.
   */
  createPriceLine(options: PriceLineOptions): PriceLineHandle {
    const id = `priceline:${this._priceLineSeq++}`;
    const primitive = new PriceLinePrimitive(id, options);
    this._engine.attachPrimitive(primitive);

    const engine = this._engine;
    return {
      id,
      setPrice(price: number): void {
        primitive.setPrice(price);
        engine.requestRender();
      },
      getPrice(): number {
        return primitive.price;
      },
      setOptions(opts): void {
        primitive.setOptions(opts);
        engine.requestRender();
      },
      remove(): void {
        engine.detachPrimitive(id);
      },
    };
  }

  /**
   * Add a price alert (C3). Returns the created {@link Alert} (with its
   * generated `a_<n>` id and resolved `condition`). An active alert is drawn
   * as a dashed amber price line; it fires once on the realtime close-price
   * tick that satisfies its condition, invoking `ChartConfig.onAlert` and
   * removing its line (one-shot — see {@link removeAlert} / re-add to re-arm).
   * Alerts are included in `saveLayoutState`.
   */
  addAlert(init: AlertInit): Alert {
    const alert = this._alerts.add(init);
    if (alert.active) this._attachAlertLine(alert);
    return alert;
  }

  /** Remove an alert by id (and its price line). Returns true if removed. */
  removeAlert(id: string): boolean {
    const removed = this._alerts.remove(id);
    if (removed) {
      this._engine.detachPrimitive(ALERT_LINE_PREFIX + id);
      this._engine.requestRender();
    }
    return removed;
  }

  /** All alerts in insertion order (fired one-shot alerts read `active: false`). */
  getAlerts(): Alert[] {
    return this._alerts.list();
  }

  /** Remove every alert and its price line. */
  clearAlerts(): void {
    for (const alert of this._alerts.list()) {
      this._engine.detachPrimitive(ALERT_LINE_PREFIX + alert.id);
    }
    this._alerts.clear();
    this._engine.requestRender();
  }

  /**
   * Attach (or refresh) the dashed price line that visualizes an active
   * alert. The line's pill shows the alert message when set, else the
   * formatted price (via the primitive's default label path).
   */
  private _attachAlertLine(alert: Alert): void {
    const id = ALERT_LINE_PREFIX + alert.id;
    // Replace any prior line for this id so a re-add/restore can't double up.
    this._engine.detachPrimitive(id);
    this._engine.attachPrimitive(
      new PriceLinePrimitive(id, {
        price: alert.price,
        color: ALERT_LINE_COLOR,
        lineStyle: 'dashed',
        ...(alert.message !== undefined ? { title: alert.message } : {}),
      }),
    );
  }

  /**
   * C3 realtime alert evaluation. Reads the current close, and on a realtime
   * frame with a known previous close runs every active alert through
   * `AlertManager.check`. Fired (one-shot) alerts dispatch `onAlert` and have
   * their price line removed. Always updates the baseline close for the next
   * tick. No-op on an empty buffer.
   */
  private _evaluateAlerts(realtime: boolean): void {
    if (this._buffer.length === 0) return;
    const close = this._buffer.lastClose();
    const prev = this._lastAlertClose;
    this._lastAlertClose = close;
    if (!realtime || prev === null) return;

    const fired = this._alerts.check(prev, close);
    if (fired.length === 0) return;
    for (const alert of fired) {
      // A fired one-shot alert removes its line (it's no longer armed). Hosts
      // that want a lingering "triggered" marker can re-read getAlerts().
      this._engine.detachPrimitive(ALERT_LINE_PREFIX + alert.id);
      this._config.onAlert?.(alert);
    }
  }

  /** Redo the last undone drawing mutation. Returns true if applied. */
  redoDrawing(): boolean {
    const applied = this._ownDrawingLayer.redo();
    if (applied) this._engine.requestRender();
    return applied;
  }

  /**
   * Snapshot the chart as a PNG data URL. Returns `null` if the
   * browser cannot provide a 2D context (sandboxed iframe).
   */
  toPNG(): string | null {
    return this._engine.toPNG();
  }

  /**
   * Override the resting cursor on the top canvas. Drawing tools use this
   * to give the user visual feedback that a tool is selected — e.g.
   * `'cell'` for "click to place a point", or `'copy'` for a ray tool.
   * Pass `null` to restore the default `'crosshair'`.
   */
  setIdleCursor(cursor: string | null): void {
    this._engine.setIdleCursor(cursor);
  }

  /**
   * Prepend older candles to the buffer without resetting the viewport.
   * Call this from your `onLoadMoreHistory` handler when you've fetched
   * more historical data. The user's current `startIndex` is shifted by
   * the number of candles that were actually added, so visually the
   * same candles stay under the cursor.
   */
  prependHistory(olderCandles: Candle[]): void {
    if (olderCandles.length === 0) return;
    const vp = this._engine.viewport;
    const lengthBefore = this._buffer.length;
    const startBefore = vp.startIndex;
    this._merger.loadHistory(olderCandles);
    const added = this._buffer.length - lengthBefore;
    vp.startIndex = startBefore + added;
    this._engine.requestRender();
  }

  /** Install a hover callback that fires on every crosshair snap. */
  setOnHover(handler: ((info: HoverInfo | null) => void) | null): void {
    this._onHover = handler;
    this._crosshair.setOnHover(handler);
  }

  /**
   * Install a double-click callback that fires with the `HoverInfo` for the
   * cursor position (or `null` outside the plot). Additive — the chart's
   * built-in double-click reset (fit-visible / reset price scale) still runs.
   */
  setOnDblClick(handler: ((info: HoverInfo | null) => void) | null): void {
    this._crosshair.setOnDblClick(handler);
  }

  /**
   * Switch crosshair mode at runtime: `'normal'` (free Y) or `'magnet'`
   * (snap Y to the nearest OHLC level of the candle under the cursor).
   */
  setCrosshairMode(mode: CrosshairMode): void {
    this._crosshair.setMode(mode);
  }

  private _onHover: ((info: HoverInfo | null) => void) | null = null;

  /**
   * Serialize the chart's layout (without data) to a JSON-safe object.
   * The result is small enough to round-trip through a URL query
   * parameter after base64 encoding — typical size is a few hundred
   * bytes. Use `saveFullState` when you also need the data window.
   *
   * `getIndicatorConfigs()` returns an empty array if the host used
   * the legacy `setIndicators(Indicator[])` path — save/load then
   * round-trips visual state but not indicators. Prefer
   * `setIndicatorConfigs` for framework wrappers.
   */
  saveLayoutState(): LayoutState {
    const vp = this._engine.viewport;
    return {
      version: 1,
      symbol: this._config.symbol,
      resolution: this._config.resolution,
      chartType: this._engine.chartType,
      theme: this._config.theme ?? 'dark',
      viewport: {
        startIndex: vp.startIndex,
        candleWidth: vp.candleWidth,
        autoFollow: vp.autoFollow,
        priceScaleMode: vp.scaleMode,
      },
      indicators: this._indicatorConfigs.slice(),
      drawings: this.getDrawings(),
      // Alerts (C3) — `Alert` is already JSON-safe; deep-copy so callers can't
      // mutate the live collection through the snapshot.
      alerts: this._alerts.list().map((a) => ({ ...a })),
    };
  }

  /**
   * Serialize the chart including the full data window. Use for
   * workspace persistence or bug reproduction where the recipient
   * should not need a transport to rehydrate. Typical size ranges
   * from 100 KB to 1 MB depending on buffer length.
   */
  saveFullState(): FullState {
    const layout = this.saveLayoutState();
    return { ...layout, data: this._collectDataWindow() };
  }

  /**
   * Restore chart state from a previously saved layout or full state.
   * Accepts both `LayoutState` and `FullState` — when `data` is
   * present it is loaded via `setData`, otherwise the current buffer
   * is preserved and only the visual/interaction layer is updated.
   *
   * Throws `ValidationError` on unknown schema version.
   *
   * Restore order is critical — changing it can leave the viewport
   * clamped, indicators stale, or a rogue paint frame rendered
   * against the wrong chartType. See the M1 spec for the rationale.
   */
  loadState(state: ChartState): void {
    // Validate the envelope before trusting any field. This is critical
    // when states cross process boundaries (share URL, localStorage,
    // server-rendered JSON) — hostile input must not crash the chart
    // or poison the buffer.
    if (typeof state !== 'object' || state === null) {
      throw new ValidationError('loadState', state, 'state must be an object');
    }
    // Step older snapshots up to the current schema version. This is
    // a no-op for v1 (no historical versions exist yet) but lets
    // shipped clients survive future v2/v3 migrations without code
    // changes in the wrappers. migrateState throws ValidationError on
    // newer-than-current versions, so we don't need to re-check
    // state.version === CURRENT_STATE_VERSION below.
    state = migrateState(state);
    if (typeof state.symbol !== 'string' || typeof state.resolution !== 'string') {
      throw new ValidationError(
        'loadState',
        state,
        'symbol and resolution must be strings',
      );
    }
    if (!Array.isArray(state.indicators)) {
      throw new ValidationError('loadState', state, 'indicators must be an array');
    }
    if (!Array.isArray(state.drawings)) {
      throw new ValidationError('loadState', state, 'drawings must be an array');
    }
    // Alerts are optional + additive (C3). Pre-C3 states omit the field; when
    // present it must be an array (each entry is re-validated on re-add).
    if (state.alerts !== undefined && !Array.isArray(state.alerts)) {
      throw new ValidationError('loadState', state, 'alerts must be an array');
    }
    if (
      typeof state.viewport !== 'object' ||
      state.viewport === null ||
      typeof state.viewport.startIndex !== 'number' ||
      typeof state.viewport.candleWidth !== 'number' ||
      typeof state.viewport.autoFollow !== 'boolean'
    ) {
      throw new ValidationError('loadState', state, 'viewport shape is invalid');
    }

    // 1. Data (optional — skipped for LayoutState). Run validateCandles
    //    against untrusted input so a corrupted state can't push
    //    garbage into the typed buffer.
    if (isFullState(state)) {
      const validated = validateCandles(state.data, 'loadState.data');
      this._buffer.clear();
      this._merger.loadHistory(validated);
    }

    // 2. Identity + display.
    if (state.symbol !== this._config.symbol || state.resolution !== this._config.resolution) {
      this._config.symbol = state.symbol;
      this._config.resolution = state.resolution;
      this._engine.setSymbol(state.symbol);
      this._engine.setResolution(state.resolution);
    }
    this._engine.setChartType(state.chartType);
    this.setTheme(state.theme);

    // 3. Indicators — rebuild through the registry. createIndicator
    //    throws on unknown types so a corrupted state can't forge an
    //    indicator class.
    this.setIndicatorConfigs(state.indicators);

    // 4. Drawings.
    this.loadDrawings(state.drawings);

    // 5. Viewport — restore width before startIndex so clamps use the
    //    right candleStep. setLayout re-derives visibleCount.
    const vp = this._engine.viewport;
    vp.candleWidth = state.viewport.candleWidth;
    if (vp.layout) vp.setLayout(vp.layout);
    vp.startIndex = state.viewport.startIndex;
    vp.autoFollow = state.viewport.autoFollow;
    // Optional + additive: pre-F1 states omit priceScaleMode → 'linear'.
    vp.setScaleMode(state.viewport.priceScaleMode ?? 'linear');

    // 6. Alerts (C3) — optional + additive. Re-add into the manager (which
    //    re-derives id collisions) and redraw lines for the active ones.
    this._restoreAlerts(state.alerts);

    this._engine.requestRender();
  }

  /**
   * Replace the alert collection from a persisted snapshot. Clears existing
   * alerts + their lines first, then re-adds each, preserving `id`,
   * `condition`, `message`, and the one-shot `active` flag (a fired alert
   * restores disarmed and without a line). `undefined` (pre-C3 state) just
   * clears, matching the "no alerts" baseline.
   */
  private _restoreAlerts(alerts: Alert[] | undefined): void {
    this.clearAlerts();
    if (!alerts) return;
    for (const a of alerts) {
      // Re-add through the manager so ids/seq stay consistent; `add` always
      // starts active, so a persisted disarmed alert is flipped back after.
      this.addAlert({
        id: a.id,
        price: a.price,
        condition: a.condition,
        ...(a.message !== undefined ? { message: a.message } : {}),
      });
      if (a.active === false) {
        this._alerts.setActive(a.id, false);
        this._engine.detachPrimitive(ALERT_LINE_PREFIX + a.id);
      }
    }
    // Reset the alert baseline so the next realtime tick re-derives `prev`
    // from current data rather than firing against a stale pre-load close.
    this._lastAlertClose = null;
  }

  /**
   * Pull a plain-object data window out of the TypedArray buffer. Used
   * by `saveFullState` — skipped when only a layout snapshot is needed.
   */
  private _collectDataWindow(): Candle[] {
    const len = this._buffer.length;
    const out: Candle[] = new Array(len);
    for (let i = 0; i < len; i++) {
      const c = this._buffer.candleAt(i);
      if (c) out[i] = c;
    }
    return out;
  }

  /** Clean up all resources. Idempotent — safe to call more than once. */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    if (this._clickHandler) {
      this._engine.topCanvas.removeEventListener('click', this._clickHandler);
      this._clickHandler = null;
    }
    if (this._dblClickHandler) {
      this._engine.topCanvas.removeEventListener('dblclick', this._dblClickHandler);
      this._dblClickHandler = null;
    }
    this._keyboard.destroy();
    this._crosshair.destroy();
    this._panZoom.destroy();
    // Stop any running replay timer before tearing down the engine so a late
    // tick can't request a render against disposed canvases.
    this._replay?.destroy();
    this._replay = null;
    this._dataFeed.destroy();
    // Cancel any pending merger RAF before tearing down the engine so
    // a late frame cannot paint into a disposed canvas.
    this._merger.destroy();
    this._engine.destroy();
    this._onHover = null;
  }

  private _destroyed = false;
}
