import type { Candle, ChartConfig, ChartType, ThemeColors, ThemeMode, HoverInfo } from './types';
import type { PriceScaleMode } from './interaction/priceScale';
import type { HorzScaleBehavior } from './horzscale/HorzScaleBehavior';
import { resolveTheme } from './utils';
import { ErrorReporter } from './ErrorReporter';
import { CandleBuffer } from './data/CandleBuffer';
import { CandleMerger } from './data/CandleMerger';
import { DataFeed } from './data/DataFeed';
import { ValidationError, validateCandles } from './data/validation';
import { ChartEngine } from './rendering/ChartEngine';
import { Viewport } from './interaction/Viewport';
import { PanZoomController } from './interaction/PanZoomController';
import { CrosshairController } from './interaction/CrosshairController';
import { KeyboardController } from './interaction/KeyboardController';
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
import type { LayoutState, FullState, ChartState } from './state/ChartState';

/** Stable primitive id for the single host-managed watermark. */
const WATERMARK_ID = 'ohlcv:watermark';
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
  | 'arrow';

export class OHLCVChart {
  private _buffer: CandleBuffer;
  private _merger: CandleMerger;
  private _dataFeed: DataFeed;
  private _engine: ChartEngine;
  private _panZoom: PanZoomController;
  private _crosshair: CrosshairController;
  private _keyboard: KeyboardController;
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
  /** Host-created price lines, keyed by id, for drag routing. */
  private _priceLines = new Map<string, PriceLinePrimitive>();
  private _priceLineSeq = 0;
  /** Set after a price-line drag so the trailing click doesn't fire onCandleClick. */
  private _suppressNextClick = false;

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
        this._priceLines.get(id)?.setPrice(price);
        this._engine.requestRender();
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

  /** Get the underlying buffer */
  getBuffer(): CandleBuffer {
    return this._buffer;
  }

  /** Get the viewport */
  getViewport(): Viewport {
    return this._engine.viewport;
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
    }
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
    this._priceLines.set(id, primitive);
    this._engine.attachPrimitive(primitive);

    const engine = this._engine;
    const lines = this._priceLines;
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
        lines.delete(id);
      },
    };
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

    this._engine.requestRender();
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
    this._dataFeed.destroy();
    // Cancel any pending merger RAF before tearing down the engine so
    // a late frame cannot paint into a disposed canvas.
    this._merger.destroy();
    this._engine.destroy();
    this._onHover = null;
  }

  private _destroyed = false;
}
