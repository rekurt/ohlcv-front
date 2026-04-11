import type { Candle, ChartConfig, ChartType, ThemeColors, ThemeMode, HoverInfo } from './types';
import { resolveTheme, formatTime } from './utils';
import { ErrorReporter } from './ErrorReporter';
import { CandleBuffer } from './data/CandleBuffer';
import { CandleMerger } from './data/CandleMerger';
import { DataFeed } from './data/DataFeed';
import { ChartEngine } from './rendering/ChartEngine';
import { Viewport } from './interaction/Viewport';
import { PanZoomController } from './interaction/PanZoomController';
import { CrosshairController } from './interaction/CrosshairController';
import { KeyboardController } from './interaction/KeyboardController';
import type { Indicator } from './indicators/Indicator';
import type { DrawingLayer } from './drawings/DrawingLayer';

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

  constructor(config: ChartConfig) {
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
    this._engine.setBuffer(this._buffer);
    this._engine.setSymbol(config.symbol);
    this._engine.setResolution(config.resolution);
    if (config.priceFormat) this._engine.setPriceFormat(config.priceFormat);
    if (config.volumeFormat) this._engine.setVolumeFormat(config.volumeFormat);
    if (config.chartType) this._engine.setChartType(config.chartType);
    config.container.style.backgroundColor = theme.background;

    // Merger triggers render. Only scroll to the live edge if the user is
    // actively following the stream; otherwise just repaint and let the
    // viewport stay wherever the user has scrolled.
    this._merger.onUpdate(() => {
      const vp = this._engine.viewport;
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
    });
    // Track pending load-more-history calls so we don't fire them faster
    // than they resolve.
    this._loadingMore = false;

    this._crosshair = new CrosshairController(this._engine, this._buffer, config.resolution);
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

    // Double-click → fit visible (reset zoom + go to live)
    this._dblClickHandler = (e: MouseEvent) => {
      const rect = this._engine.topCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const layout = this._engine.layout;
      if (x < layout.chartLeft || x > layout.chartRight || y < layout.chartTop || y > layout.chartBottom) return;
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

  /** Switch to a different symbol/resolution */
  async switchSymbol(symbol: string, resolution: string): Promise<void> {
    this._config.symbol = symbol;
    this._config.resolution = resolution;
    this._engine.setSymbol(symbol);
    this._engine.setResolution(resolution);
    this._crosshair.setResolution(resolution);
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

  /** Switch the primary price-series rendering style. */
  setChartType(chartType: ChartType): void {
    this._engine.setChartType(chartType);
  }

  /** Replace the indicator set on the chart. */
  setIndicators(indicators: Indicator[]): void {
    this._engine.setIndicators(indicators);
  }

  /** Attach (or clear) a drawing layer rendered above the price series. */
  setDrawingLayer(layer: DrawingLayer | null): void {
    this._engine.setDrawingLayer(layer);
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

  /** Clean up all resources */
  destroy(): void {
    if (this._clickHandler) {
      this._engine.topCanvas.removeEventListener('click', this._clickHandler);
    }
    if (this._dblClickHandler) {
      this._engine.topCanvas.removeEventListener('dblclick', this._dblClickHandler);
    }
    this._keyboard.destroy();
    this._crosshair.destroy();
    this._panZoom.destroy();
    this._engine.destroy();
    this._dataFeed.destroy();
  }
}
