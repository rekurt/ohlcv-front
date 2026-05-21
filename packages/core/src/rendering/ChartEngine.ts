import type { ThemeColors, ChartLayout, Candle, ChartType } from '../types';
import { computeLayout, resizeHiDPICanvas, createHiDPICanvas, formatPrice } from '../utils';
import { VOLUME_HEIGHT_RATIO, SUBPANE_HEIGHT_RATIO, SUBPANE_PADDING_Y, AXIS_FONT } from '../constants';
import type { CandleBuffer } from '../data/CandleBuffer';
import type { ErrorReporter } from '../ErrorReporter';
import { Viewport } from '../interaction/Viewport';
import { Pane, PaneLayout } from './Pane';
import { GridRenderer } from './GridRenderer';
import { CandleRenderer } from './CandleRenderer';
import { LineRenderer } from './LineRenderer';
import { AreaRenderer } from './AreaRenderer';
import { OHLCBarRenderer } from './OHLCBarRenderer';
import { VolumeRenderer } from './VolumeRenderer';
import { PriceAxisRenderer } from './PriceAxis';
import { TimeAxisRenderer } from './TimeAxis';
import { CrosshairRenderer, type CrosshairState } from './CrosshairRenderer';
import { PriceLineRenderer } from './PriceLineRenderer';
import { LegendRenderer } from './LegendRenderer';
import { GoToLiveRenderer } from './GoToLiveRenderer';
import { OverlaySeriesRenderer } from './OverlaySeriesRenderer';
import type { Indicator, IndicatorSeries } from '../indicators/Indicator';
import type { DrawingLayer } from '../drawings/DrawingLayer';

/** Palette used to color indicator series in deterministic order. */
const INDICATOR_COLORS = [
  '#2962ff', // blue
  '#ff6d00', // orange
  '#aa00ff', // purple
  '#00c853', // green
  '#ff1744', // red
  '#00bcd4', // cyan
  '#ffd600', // yellow
];

export class ChartEngine {
  readonly viewport: Viewport;
  private _container: HTMLElement;
  private _chartCanvas: HTMLCanvasElement;
  private _uiCanvas: HTMLCanvasElement;
  private _crosshairCanvas: HTMLCanvasElement;
  private _chartCtx: CanvasRenderingContext2D;
  private _uiCtx: CanvasRenderingContext2D;
  private _crosshairCtx: CanvasRenderingContext2D;
  /** Main price-pane area. Shrinks vertically when sub-panes are present. */
  private _layout!: ChartLayout;
  /** Full plot area (price + all sub-panes). Used for the shared time axis. */
  private _baseLayout!: ChartLayout;
  private _width = 0;
  private _height = 0;
  /** Vertical stack of panes: main price pane + one per `'pane'` indicator. */
  private _paneLayout = new PaneLayout();
  private _theme: ThemeColors;
  private _reporter: ErrorReporter | null = null;
  private _buffer: CandleBuffer | null = null;
  private _symbol = '';
  private _resolution = '';
  private _priceFormat?: (price: number) => string;
  private _volumeFormat?: (volume: number) => string;
  private _chartType: ChartType = 'candles';

  /** User-provided indicators; each is computed on every dirty render. */
  private _indicators: Indicator[] = [];
  /** Optional drawing layer rendered on top of candles. */
  private _drawingLayer: DrawingLayer | null = null;

  // Renderers
  private _gridRenderer = new GridRenderer();
  private _candleRenderer = new CandleRenderer();
  private _lineRenderer = new LineRenderer();
  private _areaRenderer = new AreaRenderer();
  private _ohlcBarRenderer = new OHLCBarRenderer();
  private _volumeRenderer = new VolumeRenderer();
  private _priceAxisRenderer = new PriceAxisRenderer();
  private _timeAxisRenderer = new TimeAxisRenderer();
  private _crosshairRenderer = new CrosshairRenderer();
  private _priceLineRenderer = new PriceLineRenderer();
  private _legendRenderer = new LegendRenderer();
  private _overlayRenderer = new OverlaySeriesRenderer();
  readonly goToLiveRenderer = new GoToLiveRenderer();

  // State
  private _crosshairState: CrosshairState = { x: 0, y: 0, price: 0, time: '', visible: false };
  private _legendCandle: Candle | null = null;
  private _chartDirty = true;
  private _uiDirty = true;
  private _crosshairDirty = false;
  private _rafId = 0;
  private _resizeObserver: ResizeObserver | null = null;

  /**
   * Off-screen ARIA live region used to announce crosshair changes to
   * screen readers. Populated on every setCrosshair call with a
   * human-readable OHLC summary of the hovered candle.
   */
  private _a11yLiveRegion!: HTMLDivElement;
  private _lastA11yAnnouncement = '';

  constructor(container: HTMLElement, theme: ThemeColors) {
    this._container = container;
    this._theme = theme;

    // Create 3 stacked canvases
    const rect = container.getBoundingClientRect();
    const w = rect.width || 800;
    const h = rect.height || 400;

    container.style.position = 'relative';
    container.style.overflow = 'hidden';

    this._chartCanvas = this._createLayerCanvas(w, h, 1);
    this._uiCanvas = this._createLayerCanvas(w, h, 2);
    this._crosshairCanvas = this._createLayerCanvas(w, h, 3);

    // The lower canvases are purely decorative — screen readers should
    // ignore them entirely so the user only encounters one interactive
    // chart element instead of three.
    this._chartCanvas.setAttribute('aria-hidden', 'true');
    this._uiCanvas.setAttribute('aria-hidden', 'true');

    // Make the top canvas focusable so it can receive keyboard events.
    this._crosshairCanvas.tabIndex = 0;
    // WCAG 2.4.7: keep a visible focus indicator. Default browser focus
    // rings often look bad on dark chart backgrounds; we use a subtle
    // inset box-shadow via a data-attribute so consumers can override
    // via CSS without fighting an inline style.
    this._crosshairCanvas.setAttribute('data-ohlcv-focusable', 'true');
    // Accessibility: label the interactive canvas as an application image
    // and describe its purpose. Screen readers that don't speak canvas
    // pixel content will at least announce "OHLCV price chart" on focus.
    this._crosshairCanvas.setAttribute('role', 'img');
    this._crosshairCanvas.setAttribute(
      'aria-label',
      'OHLCV price chart. Use arrow keys to pan, plus and minus to zoom, Home and End to jump.',
    );

    // Live region for screen-reader-friendly crosshair announcements.
    // Positioned off-screen; updated imperatively from setCrosshair.
    // Only one instance per chart; kept inside the container so it is
    // cleaned up along with the canvases on destroy.
    this._a11yLiveRegion = document.createElement('div');
    this._a11yLiveRegion.setAttribute('role', 'status');
    this._a11yLiveRegion.setAttribute('aria-live', 'polite');
    this._a11yLiveRegion.setAttribute('aria-atomic', 'true');
    // Visually hidden but still in the accessibility tree.
    this._a11yLiveRegion.style.cssText =
      'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';

    container.appendChild(this._chartCanvas);
    container.appendChild(this._uiCanvas);
    container.appendChild(this._crosshairCanvas);
    container.appendChild(this._a11yLiveRegion);

    this._chartCtx = this._chartCanvas.getContext('2d')!;
    this._uiCtx = this._uiCanvas.getContext('2d')!;
    this._crosshairCtx = this._crosshairCanvas.getContext('2d')!;

    this.viewport = new Viewport();
    this._width = w;
    this._height = h;
    this._recomputeLayout();

    // ResizeObserver. Guarded against missing implementation (jsdom,
    // very old browsers). When unavailable, the chart never auto-resizes
    // — consumers can still call chart.render() after a manual resize,
    // and the initial layout from the constructor still renders correctly.
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) this.resize(width, height);
        }
      });
      this._resizeObserver.observe(container);
    }
  }

  /** Top canvas — for event listeners */
  get topCanvas(): HTMLCanvasElement {
    return this._crosshairCanvas;
  }

  get layout(): ChartLayout {
    return this._layout;
  }

  setBuffer(buffer: CandleBuffer): void {
    this._buffer = buffer;
  }

  /**
   * Route indicator-compute and render errors through the host's
   * `onError` callback instead of swallowing them silently.
   */
  setErrorReporter(reporter: ErrorReporter): void {
    this._reporter = reporter;
  }

  /** The vertical pane stack (main price pane + indicator sub-panes). */
  get paneLayout(): PaneLayout {
    return this._paneLayout;
  }

  /**
   * Rebuild the pane stack from the current indicator set: the main price
   * pane plus one sub-pane per `placement: 'pane'` indicator, in declared
   * order. Re-derives all layout bounds afterwards.
   */
  private _syncPaneLayout(): void {
    const layout = new PaneLayout();
    for (const indicator of this._indicators) {
      if (indicator.placement === 'pane') {
        layout.addPane(new Pane(indicator.id, 'indicator', SUBPANE_HEIGHT_RATIO));
      }
    }
    this._paneLayout = layout;
    this._recomputeLayout();
  }

  /**
   * Recompute the full plot area, distribute it across panes, and derive
   * the (possibly shrunk) main price-pane layout that the price/volume
   * renderers and the viewport consume. With no sub-panes the main pane
   * fills the whole area and the layout is identical to the single-pane
   * behavior.
   */
  private _recomputeLayout(): void {
    this._baseLayout = computeLayout(this._width, this._height);
    this._paneLayout.computeBounds(this._baseLayout.chartTop, this._baseLayout.chartBottom);

    const main = this._paneLayout.main;
    const mainHeight = main.bottom - main.top;
    this._layout = {
      ...this._baseLayout,
      chartTop: main.top,
      chartBottom: main.bottom,
      volumeTop: main.bottom - mainHeight * VOLUME_HEIGHT_RATIO,
      volumeBottom: main.bottom,
    };
    this.viewport.setLayout(this._layout);
  }

  setSymbol(symbol: string): void {
    this._symbol = symbol;
  }

  setResolution(resolution: string): void {
    this._resolution = resolution;
  }

  setPriceFormat(fn?: (price: number) => string): void {
    this._priceFormat = fn;
  }

  setVolumeFormat(fn?: (price: number) => string): void {
    this._volumeFormat = fn;
  }

  setTheme(theme: ThemeColors): void {
    this._theme = theme;
    this._container.style.backgroundColor = theme.background;
    this.requestRender();
  }

  /**
   * Override the resting cursor on the top canvas. Used by drawing tools
   * in consumer code to signal "click to place a point" — e.g. `'crosshair'`
   * for selection, `'cell'` or `'copy'` while a trend line is being drawn.
   *
   * PanZoomController still temporarily switches to `'grabbing'` during an
   * active drag and back to the idle cursor on release, so mouse-up after
   * a drag does not clobber the tool's cursor choice.
   *
   * Pass `null` to restore the default `'crosshair'`.
   */
  setIdleCursor(cursor: string | null): void {
    this._idleCursor = cursor ?? 'crosshair';
    if (!this._isActivelyDragging) {
      this._crosshairCanvas.style.cursor = this._idleCursor;
    }
  }

  /** The cursor the top canvas shows when no drag is in progress. */
  get idleCursor(): string {
    return this._idleCursor;
  }

  /**
   * Called by PanZoomController on mousedown/mouseup so the engine knows
   * whether to honor `setIdleCursor` writes or defer them. Internal API,
   * not exported.
   */
  _setActivelyDragging(dragging: boolean): void {
    this._isActivelyDragging = dragging;
  }

  private _idleCursor = 'crosshair';
  private _isActivelyDragging = false;

  /** Switch the primary price-series rendering style. */
  setChartType(chartType: ChartType): void {
    if (this._chartType === chartType) return;
    this._chartType = chartType;
    this.requestRender();
  }

  get chartType(): ChartType {
    return this._chartType;
  }

  /**
   * Replace the indicator set. Indicators with `placement: 'overlay'`
   * are drawn on top of the price series in deterministic palette
   * order. Indicators with `placement: 'pane'` each get their own
   * sub-pane with an independent Y-axis, stacked below the price pane.
   */
  setIndicators(indicators: Indicator[]): void {
    this._indicators = indicators;
    this._syncPaneLayout();
    this.requestRender();
  }

  /** The currently-configured indicators, in render order. */
  get indicators(): readonly Indicator[] {
    return this._indicators;
  }

  /**
   * Attach a DrawingLayer whose drawings will be rendered on top of
   * the price area. Pass `null` to detach. The chart takes no input
   * events for the drawing layer — consumers listen on `topCanvas`
   * and drive creation via `layer.addPoint(...)` themselves.
   */
  setDrawingLayer(layer: DrawingLayer | null): void {
    this._drawingLayer = layer;
    this.requestRender();
  }

  /** Mark chart + UI for re-render */
  requestRender(): void {
    this._chartDirty = true;
    this._uiDirty = true;
    this._scheduleRaf();
  }

  /** Update crosshair position */
  setCrosshair(x: number, y: number, snapIndex: number, candle: Candle | null, timeLabel: string): void {
    this._crosshairState = {
      x,
      y,
      price: this.viewport.yToPrice(y),
      time: timeLabel,
      visible: true,
    };
    if (candle) {
      this._legendCandle = candle;
      // Update the aria-live region with an OHLC summary for screen
      // readers. We dedupe identical announcements so hovering inside a
      // single candle doesn't flood the live region every RAF.
      const announcement = this._formatA11yAnnouncement(candle, timeLabel);
      if (announcement !== this._lastA11yAnnouncement) {
        this._lastA11yAnnouncement = announcement;
        this._a11yLiveRegion.textContent = announcement;
      }
    }
    this._crosshairDirty = true;
    this._uiDirty = true;
    this._scheduleRaf();
  }

  private _formatA11yAnnouncement(candle: Candle, timeLabel: string): string {
    const fmt = this._priceFormat ?? ((p: number) => p.toFixed(2));
    return `${this._symbol} ${timeLabel}: open ${fmt(candle.o)}, high ${fmt(candle.h)}, low ${fmt(candle.l)}, close ${fmt(candle.c)}`;
  }

  /** Hide crosshair and show last candle in legend */
  hideCrosshair(): void {
    this._crosshairState.visible = false;
    if (this._buffer && this._buffer.length > 0) {
      this._legendCandle = this._buffer.candleAt(this._buffer.length - 1);
    }
    this._crosshairDirty = true;
    this._uiDirty = true;
    this._scheduleRaf();
  }

  resize(width: number, height: number): void {
    // Guard against NaN/Infinity/zero/negative dimensions. These can
    // come from a hidden container (display:none → rect.width=0),
    // a ResizeObserver entry during a CSS transition, or a broken
    // container shrunk below zero width. Skip the resize entirely —
    // the chart will keep its previous layout and try again on the
    // next resize event.
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return;
    }

    this._width = width;
    this._height = height;
    this._recomputeLayout();

    // resizeHiDPICanvas resets canvas.width/height (which clears the transform)
    // and re-applies ctx.scale(dpr, dpr) internally. Do not re-scale here —
    // getContext('2d') returns the same context object, and an extra scale call
    // would compound with the one already applied, resulting in dpr² scaling.
    resizeHiDPICanvas(this._chartCanvas, width, height);
    resizeHiDPICanvas(this._uiCanvas, width, height);
    resizeHiDPICanvas(this._crosshairCanvas, width, height);

    this.requestRender();
  }

  destroy(): void {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    this._chartCanvas.remove();
    this._uiCanvas.remove();
    this._crosshairCanvas.remove();
    this._a11yLiveRegion?.remove();
  }

  /**
   * Snapshot the current chart state as a flat PNG data URL. Composites
   * all three canvas layers onto a single offscreen canvas so the
   * result is independent of DOM state.
   *
   * Synchronous. Returns a `data:image/png;base64,...` string suitable
   * for `<img src>`, download links, or uploading to a backend. Returns
   * `null` if the browser refuses to provide a 2D context on the
   * offscreen canvas (should never happen outside of sandboxed iframes).
   */
  toPNG(): string | null {
    const snapshot = document.createElement('canvas');
    snapshot.width = this._chartCanvas.width;
    snapshot.height = this._chartCanvas.height;
    const ctx = snapshot.getContext('2d');
    if (!ctx) return null;

    // Fill the background first so transparent pixels in any layer
    // don't bleed through to the final image.
    ctx.fillStyle = this._theme.background;
    ctx.fillRect(0, 0, snapshot.width, snapshot.height);

    // Composite the three layers bottom-up. We draw the source canvases
    // at their native device-pixel size so the snapshot preserves
    // HiDPI sharpness if any.
    ctx.drawImage(this._chartCanvas, 0, 0);
    ctx.drawImage(this._uiCanvas, 0, 0);
    ctx.drawImage(this._crosshairCanvas, 0, 0);

    return snapshot.toDataURL('image/png');
  }

  private _scheduleRaf(): void {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = 0;
      this._render();
    });
  }

  private _render(): void {
    if (!this._buffer) return;

    // Auto-scale
    this.viewport.autoScale(this._buffer);

    const start = Math.max(0, Math.floor(this.viewport.startIndex));
    const end = Math.min(this._buffer.length, Math.ceil(this.viewport.startIndex + this.viewport.visibleCount) + 1);
    const view = this._buffer.sliceView(start, end);

    if (this._chartDirty) {
      this._chartDirty = false;
      const ctx = this._chartCtx;
      const { width, height } = this._layout;
      ctx.clearRect(0, 0, width, height);

      // Background
      ctx.fillStyle = this._theme.background;
      ctx.fillRect(0, 0, width, height);

      // Grid → Volume → primary series (by chart type) → overlay indicators
      // → drawings → Axes. Drawings sit above indicators so a trend line
      // is visible on top of SMA/EMA/BB clutter.
      this._gridRenderer.render(ctx, this._layout, this.viewport, this._theme);
      this._volumeRenderer.render(ctx, this._layout, this.viewport, view, this._theme);

      switch (this._chartType) {
        case 'line':
          this._lineRenderer.render(ctx, this._layout, this.viewport, view, this._theme);
          break;
        case 'area':
          this._areaRenderer.render(ctx, this._layout, this.viewport, view, this._theme);
          break;
        case 'ohlc':
          this._ohlcBarRenderer.render(ctx, this._layout, this.viewport, view, this._theme);
          break;
        case 'candles':
        default:
          this._candleRenderer.render(ctx, this._layout, this.viewport, view, this._theme);
          break;
      }

      // Overlay indicators drawn on the main price pane.
      let colorIdx = 0;
      for (const indicator of this._indicators) {
        if (indicator.placement !== 'overlay') continue;
        let series: IndicatorSeries[];
        try {
          series = indicator.compute(this._buffer);
        } catch (err) {
          // Indicator compute errors are non-fatal; report and skip this one.
          this._reporter?.report('indicator', err, false);
          continue;
        }
        for (const s of series) {
          const color = INDICATOR_COLORS[colorIdx % INDICATOR_COLORS.length]!;
          colorIdx++;
          this._overlayRenderer.render(ctx, this._layout, this.viewport, s, color, this._theme);
        }
      }

      // Drawing layer on top of indicators.
      if (this._drawingLayer) {
        this._drawingLayer.render(ctx, this._layout, this.viewport, this._theme);
      }

      this._priceAxisRenderer.render(ctx, this._layout, this.viewport, this._theme, this._priceFormat);

      // Sub-panes for `placement: 'pane'` indicators, stacked below the
      // price pane. Each has its own auto-scaled (or fixed) Y-axis.
      this._renderSubPanes(ctx, start, end);

      // Shared time axis sits at the very bottom, under all panes.
      this._timeAxisRenderer.render(ctx, this._baseLayout, this.viewport, this._buffer, this._resolution, this._theme);
    }

    if (this._uiDirty) {
      this._uiDirty = false;
      const ctx = this._uiCtx;
      ctx.clearRect(0, 0, this._layout.width, this._layout.height);

      // Current price line + label
      if (this._buffer.length > 0) {
        const lastClose = this._buffer.lastClose();
        const lastCandle = this._buffer.candleAt(this._buffer.length - 1);
        const isBull = lastCandle ? lastCandle.c >= lastCandle.o : true;
        this._priceLineRenderer.render(ctx, this._layout, this.viewport, lastClose, this._theme);
        this._priceAxisRenderer.drawCurrentPrice(ctx, this._layout, this.viewport, lastClose, isBull, this._theme, this._priceFormat);
      }

      // Legend
      const legendCandle = this._legendCandle || (this._buffer.length > 0 ? this._buffer.candleAt(this._buffer.length - 1) : null);
      this._legendRenderer.render(
        ctx, this._layout, legendCandle, this._symbol, this._resolution, this._theme, this._priceFormat, this._volumeFormat,
      );

      // Floating "Go to live" pill when the user has scrolled away from the live edge.
      if (!this.viewport.autoFollow && this._buffer.length > 0) {
        this.goToLiveRenderer.render(ctx, this._layout, this._theme);
      } else {
        this.goToLiveRenderer.hide();
      }
    }

    if (this._crosshairDirty) {
      this._crosshairDirty = false;
      const ctx = this._crosshairCtx;
      ctx.clearRect(0, 0, this._layout.width, this._layout.height);
      // Use the full plot area so the vertical line spans every pane and the
      // time label sits on the shared bottom axis.
      this._crosshairRenderer.render(ctx, this._baseLayout, this.viewport, this._crosshairState, this._theme, this._priceFormat);
    }
  }

  /**
   * Render every `'pane'` indicator into its own sub-pane below the price
   * pane. X-positions reuse the shared viewport mapping; Y is mapped through
   * each pane's own (auto-scaled or fixed) range. `start`/`end` bound the
   * visible buffer window used for auto-scaling.
   */
  private _renderSubPanes(ctx: CanvasRenderingContext2D, start: number, end: number): void {
    if (!this._buffer) return;
    const subPanes = this._paneLayout.panes.filter((p) => p.kind === 'indicator');
    if (subPanes.length === 0) return;

    for (const pane of subPanes) {
      const indicator = this._indicators.find((i) => i.id === pane.id);
      if (!indicator) continue;

      let series: IndicatorSeries[];
      try {
        series = indicator.compute(this._buffer);
      } catch (err) {
        this._reporter?.report('indicator', err, false);
        continue;
      }

      this._scaleSubPane(pane, indicator, series, start, end);
      this._paintSubPane(ctx, pane, indicator, series);
    }
  }

  /** Set a sub-pane's priceMin/priceMax from its fixed range or visible data. */
  private _scaleSubPane(
    pane: Pane,
    indicator: Indicator,
    series: IndicatorSeries[],
    start: number,
    end: number,
  ): void {
    const fixed = indicator.paneRange;
    if (fixed) {
      pane.priceMin = fixed.min;
      pane.priceMax = fixed.max;
      return;
    }

    let min = Infinity;
    let max = -Infinity;
    for (const s of series) {
      const values = s.values;
      const hi = Math.min(values.length, end);
      for (let i = Math.max(0, start); i < hi; i++) {
        const v = values[i]!;
        if (!Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      pane.priceMin = 0;
      pane.priceMax = 1;
      return;
    }
    if (min === max) {
      const pad = Math.abs(max) * 0.05 || 1;
      min -= pad;
      max += pad;
    } else {
      const pad = (max - min) * 0.1;
      min -= pad;
      max += pad;
    }
    pane.priceMin = min;
    pane.priceMax = max;
  }

  /** Draw one sub-pane: separator, reference lines, series, label, axis. */
  private _paintSubPane(
    ctx: CanvasRenderingContext2D,
    pane: Pane,
    indicator: Indicator,
    series: IndicatorSeries[],
  ): void {
    const layout = this._layout;
    const left = layout.chartLeft;
    const right = layout.chartRight;
    // Inset the value-mapping band so lines don't touch the separators.
    pane.top += SUBPANE_PADDING_Y;
    pane.bottom -= SUBPANE_PADDING_Y;
    const drawTop = pane.top - SUBPANE_PADDING_Y;
    const drawBottom = pane.bottom + SUBPANE_PADDING_Y;

    // Top separator line.
    ctx.strokeStyle = this._theme.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, Math.round(drawTop) + 0.5);
    ctx.lineTo(right, Math.round(drawTop) + 0.5);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, drawTop, right - left, drawBottom - drawTop);
    ctx.clip();

    // Reference lines (e.g. RSI 30/70).
    const refs = indicator.referenceLines;
    if (refs.length > 0) {
      ctx.strokeStyle = this._theme.grid;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      for (const level of refs) {
        const y = Math.round(pane.priceToY(level)) + 0.5;
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Series. A `histogram` series renders as zero-anchored bars; the rest
    // render as lines.
    let colorIdx = 0;
    for (const s of series) {
      if (s.name === 'histogram') {
        this._paintSubPaneHistogram(ctx, pane, s);
      } else {
        const color = INDICATOR_COLORS[colorIdx % INDICATOR_COLORS.length]!;
        this._paintSubPaneLine(ctx, pane, s, color);
      }
      colorIdx++;
    }
    ctx.restore();

    // Indicator label (top-left).
    ctx.fillStyle = this._theme.text;
    ctx.font = AXIS_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(indicator.id, left + 4, drawTop + 3);

    // Min/max axis labels on the right.
    const fmt = this._priceFormat ?? formatPrice;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(fmt(pane.priceMax), right + 4, drawTop + 2);
    ctx.textBaseline = 'bottom';
    ctx.fillText(fmt(pane.priceMin), right + 4, drawBottom - 2);

    // Restore the pane bounds we mutated for the inset.
    pane.top -= SUBPANE_PADDING_Y;
    pane.bottom += SUBPANE_PADDING_Y;
  }

  private _paintSubPaneLine(
    ctx: CanvasRenderingContext2D,
    pane: Pane,
    s: IndicatorSeries,
    color: string,
  ): void {
    const values = s.values;
    const startIdx = Math.max(0, Math.floor(this.viewport.startIndex) - 2);
    const endIdx = Math.min(values.length, Math.ceil(this.viewport.startIndex + this.viewport.visibleCount) + 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let pen = false;
    for (let i = startIdx; i < endIdx; i++) {
      const v = values[i]!;
      if (!Number.isFinite(v)) {
        pen = false;
        continue;
      }
      const x = this.viewport.indexToX(i);
      const y = pane.priceToY(v);
      if (!pen) {
        ctx.moveTo(x, y);
        pen = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  private _paintSubPaneHistogram(
    ctx: CanvasRenderingContext2D,
    pane: Pane,
    s: IndicatorSeries,
  ): void {
    const values = s.values;
    const startIdx = Math.max(0, Math.floor(this.viewport.startIndex) - 2);
    const endIdx = Math.min(values.length, Math.ceil(this.viewport.startIndex + this.viewport.visibleCount) + 2);
    const zeroY = pane.priceToY(0);
    const barW = Math.max(1, this.viewport.candleWidth);
    for (let i = startIdx; i < endIdx; i++) {
      const v = values[i]!;
      if (!Number.isFinite(v)) continue;
      const x = this.viewport.indexToX(i);
      const y = pane.priceToY(v);
      ctx.fillStyle = v >= 0 ? this._theme.bullCandle : this._theme.bearCandle;
      ctx.fillRect(x - barW / 2, Math.min(y, zeroY), barW, Math.abs(y - zeroY));
    }
  }

  private _createLayerCanvas(w: number, h: number, zIndex: number): HTMLCanvasElement {
    const canvas = createHiDPICanvas(w, h);
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.zIndex = String(zIndex);
    if (zIndex < 3) canvas.style.pointerEvents = 'none';
    return canvas;
  }
}
