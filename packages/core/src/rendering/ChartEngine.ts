import type { ThemeColors, ChartLayout, Candle, CandleView } from '../types';
import { computeLayout, resizeHiDPICanvas, createHiDPICanvas } from '../utils';
import type { CandleBuffer } from '../data/CandleBuffer';
import { conflate } from '../data/conflate';
import { RangePyramid } from '../data/RangePyramid';
import type { ErrorReporter } from '../ErrorReporter';
import { Viewport } from '../interaction/Viewport';
import { GridRenderer } from './GridRenderer';
import { VolumeRenderer } from './VolumeRenderer';
import { PriceAxisRenderer } from './PriceAxis';
import { TimeAxisRenderer } from './TimeAxis';
import { CrosshairRenderer, type CrosshairState } from './CrosshairRenderer';
import { PriceLineRenderer } from './PriceLineRenderer';
import { LegendRenderer } from './LegendRenderer';
import { GoToLiveRenderer } from './GoToLiveRenderer';
import { OverlaySeriesRenderer } from './OverlaySeriesRenderer';
import { IndicatorPaneRenderer } from './IndicatorPaneRenderer';
import { getSeriesType, DEFAULT_SERIES } from '../series/registry';
import type { SeriesDefinition } from '../series/Series';
import { TimeScaleBehavior } from '../horzscale/TimeScaleBehavior';
import type { HorzScaleBehavior } from '../horzscale/HorzScaleBehavior';
import { MarkerRenderer } from '../markers/MarkerRenderer';
import type { Marker } from '../markers/Marker';
import type { Indicator, IndicatorSeries } from '../indicators/Indicator';
import type { DrawingLayer } from '../drawings/DrawingLayer';
import type { Primitive, PrimitiveZOrder } from '../primitives/Primitive';
import { createI18n, type I18n } from '../i18n/messages';

/**
 * Interpolated domain value at a (possibly fractional) logical index — used
 * to build the non-uniform horizontal coordinate mapping. Integer indices
 * (the common case) return the exact value; fractional indices linearly
 * interpolate between neighbors so drawings positioned mid-bar still land
 * sensibly on a value-spaced axis.
 */
/**
 * Length-capped view over the same backing arrays (zero-copy subarrays).
 * Used to scan only the visible bars for autoscale while keeping the +1
 * render-only bar in the view used for drawing. Returns the input unchanged
 * when no capping is needed.
 */
function capView(view: CandleView, count: number): CandleView {
  if (count >= view.length) return view;
  const n = Math.max(0, count);
  return {
    open: view.open.subarray(0, n),
    high: view.high.subarray(0, n),
    low: view.low.subarray(0, n),
    close: view.close.subarray(0, n),
    volume: view.volume.subarray(0, n),
    time: view.time.subarray(0, n),
    length: n,
    offset: view.offset,
    repIndex: view.repIndex ? view.repIndex.subarray(0, n) : undefined,
  };
}

function domainValueAt(
  behavior: HorzScaleBehavior,
  buffer: CandleBuffer,
  index: number,
): number {
  const lo = Math.floor(index);
  const a = behavior.fromLogical(lo, buffer);
  if (a === null) return behavior.fromLogical(Math.round(index), buffer) ?? 0;
  const frac = index - lo;
  if (frac === 0) return a;
  const b = behavior.fromLogical(lo + 1, buffer);
  return b === null ? a : a + (b - a) * frac;
}

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
  private _layout!: ChartLayout;
  private _theme: ThemeColors;
  private _buffer: CandleBuffer | null = null;
  /** Coarse range index over the buffer; accelerates autoScale on huge windows. */
  private _rangePyramid: RangePyramid | null = null;
  /**
   * Replay-mode virtual end of buffer (C1). When non-null the renderer
   * behaves as if the buffer were only `_replayCap` candles long — the visible
   * window, autoscale, last candle (legend/price line) all stop at the cap so
   * bar-by-bar playback reveals history progressively. `null` (the default)
   * means "no cap": {@link _effectiveLength} returns the real buffer length and
   * every render path is bit-for-bit identical to the pre-replay engine.
   */
  private _replayCap: number | null = null;
  private _symbol = '';
  private _resolution = '';
  private _priceFormat?: (price: number) => string;
  private _volumeFormat?: (volume: number) => string;
  private _chartType: string = 'candles';

  /**
   * Localization bundle (C6): translated strings + locale-aware number/date
   * formatters. Defaults to a no-locale {@link createI18n}, whose formatters
   * are the exact locale-agnostic `utils` defaults and whose strings are the
   * legacy English ones — so a chart that never calls {@link setI18n} renders
   * byte-for-byte as before.
   */
  private _i18n: I18n = createI18n();

  /** Horizontal-domain behavior (axis labels). Defaults to time. */
  private _timeScale = new TimeScaleBehavior();
  private _horzScale: HorzScaleBehavior = this._timeScale;

  /** User-provided indicators; computed via `computeCached` on dirty render. */
  private _indicators: Indicator[] = [];
  /** Optional drawing layer rendered on top of candles. */
  private _drawingLayer: DrawingLayer | null = null;
  /** Point markers anchored to candles by timestamp. */
  private _markers: Marker[] = [];
  /** Programmatic z-ordered overlays (watermark, price lines, custom bands). */
  private _primitives: Primitive[] = [];
  /** Routes indicator-compute / render errors to the host's `onError`. */
  private _reporter: ErrorReporter | null = null;

  // Renderers. Primary price series are dispatched through the series
  // registry (see _render); only the chrome renderers are held here.
  private _gridRenderer = new GridRenderer();
  private _volumeRenderer = new VolumeRenderer();
  private _priceAxisRenderer = new PriceAxisRenderer();
  private _timeAxisRenderer = new TimeAxisRenderer();
  private _crosshairRenderer = new CrosshairRenderer();
  private _priceLineRenderer = new PriceLineRenderer();
  private _legendRenderer = new LegendRenderer();
  private _overlayRenderer = new OverlaySeriesRenderer();
  private _paneRenderer = new IndicatorPaneRenderer();
  private _markerRenderer = new MarkerRenderer();
  readonly goToLiveRenderer = new GoToLiveRenderer();

  // State
  private _crosshairState: CrosshairState = { x: 0, y: 0, price: 0, time: '', visible: false, inMainPane: true };
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
  /** Snapped candle index last shown in the legend; -1 when crosshair hidden. */
  private _lastLegendIndex = -1;

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
    // pixel content will at least announce the chart label on focus. The
    // label text is i18n-driven (C6) — _applyAriaLabel writes the current
    // localized string; here it's the English default.
    this._crosshairCanvas.setAttribute('role', 'img');
    this._applyAriaLabel();

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
    this._layout = computeLayout(w, h);
    this.viewport.setLayout(this._layout);

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

  /**
   * The active theme's background color. Exposed so the off-screen SVG export
   * ({@link chartEngineToSVG}) can paint a guaranteed full-bleed backdrop
   * matching the on-screen chart. Read-only — set the theme via {@link setTheme}.
   */
  get themeBackground(): string {
    return this._theme.background;
  }

  setBuffer(buffer: CandleBuffer): void {
    this._buffer = buffer;
    this._rangePyramid = new RangePyramid(buffer);
  }

  /**
   * Set the replay-mode virtual buffer end (C1), or `null` to disable replay
   * and render the full buffer again. A non-null `cap` is clamped into
   * `[1, buffer.length]` so the renderer always has at least one — and never
   * more than the real number of — candles to show. Passing `null` is the
   * default-equivalent state; the next render is bit-for-bit identical to a
   * chart that never entered replay.
   *
   * Does not itself request a render — the caller (ReplayController) decides
   * when to repaint so a seek+render is a single frame.
   */
  setReplayCap(cap: number | null): void {
    if (cap == null) {
      this._replayCap = null;
      return;
    }
    const len = this._buffer ? this._buffer.length : 0;
    // Nothing to cap against (empty buffer): treat as "no replay".
    if (len <= 0) {
      this._replayCap = null;
      return;
    }
    // Clamp into [1, len]; floor so a fractional cap can't reveal half a bar.
    this._replayCap = Math.max(1, Math.min(len, Math.floor(cap)));
  }

  /** The current replay cap (virtual buffer end), or `null` when not replaying. */
  getReplayCap(): number | null {
    return this._replayCap;
  }

  /**
   * Effective number of candles the renderer should treat as "present".
   * Equal to the real buffer length unless a replay cap is active, in which
   * case it is `min(buffer.length, cap)`. When `_replayCap == null` this
   * returns exactly `buffer.length`, so every `_render` path that swaps a
   * `buffer.length` for this stays bit-for-bit unchanged in the default case.
   */
  private _effectiveLength(): number {
    const len = this._buffer ? this._buffer.length : 0;
    return this._replayCap == null ? len : Math.min(len, this._replayCap);
  }

  /**
   * Resolve a timestamp to a (fractional) buffer index against the live buffer,
   * the seam behind {@link Viewport.timeToX} for time-keyed overlay primitives
   * (C2 compare). Returns NaN when no buffer is set so the overlay skips
   * painting. Kept tiny + buffer-delegating so it adds nothing to the base
   * bundle beyond the closure installed in {@link _computeRenderGeometry}.
   */
  private _timeToFractionalIndex(t: number): number {
    return this._buffer ? this._buffer.fractionalIndexOfTime(t) : NaN;
  }

  /**
   * Zero-copy slice of the candles currently inside the visible window
   * `[startIndex, startIndex + visibleCount)`, clamped to the effective
   * (replay-capped) buffer end and EXCLUDING the +1 render-only bar — so it
   * matches the bars the user actually sees. Returns `null` when no buffer is
   * set or the window is empty.
   *
   * This is the seam an optional, attach-only overlay (C4 Volume Profile) reads
   * its source data through without ever importing the buffer: the controller
   * holds a `() => engine.visibleCandleView()` closure and the primitive folds
   * the returned typed arrays into price bins. Tiny + buffer-delegating, so it
   * adds nothing meaningful to the base bundle (the profile module itself is
   * never statically imported here, so it tree-shakes out).
   */
  visibleCandleView(): CandleView | null {
    if (!this._buffer) return null;
    const effLen = this._effectiveLength();
    const start = Math.max(0, Math.floor(this.viewport.startIndex));
    const end = Math.min(
      effLen,
      Math.ceil(this.viewport.startIndex + this.viewport.visibleCount),
    );
    if (end <= start) return null;
    return this._buffer.sliceView(start, end);
  }

  /**
   * Route indicator-compute and render errors through the host's
   * `onError` callback instead of swallowing them silently.
   */
  setErrorReporter(reporter: ErrorReporter): void {
    this._reporter = reporter;
  }

  setSymbol(symbol: string): void {
    this._symbol = symbol;
  }

  setResolution(resolution: string): void {
    this._resolution = resolution;
    this._timeScale.setResolution(resolution);
    // Keep an active, caller-supplied time scale in sync too.
    if (this._horzScale instanceof TimeScaleBehavior) {
      this._horzScale.setResolution(resolution);
    }
  }

  /**
   * Replace the horizontal-scale behavior (time / price / custom). Controls
   * how the X axis is labeled. Pass a {@link TimeScaleBehavior} (default),
   * {@link PriceScaleBehavior}, or a custom one. A supplied TimeScaleBehavior
   * inherits the chart's current resolution so daily/weekly charts don't fall
   * back to intraday HH:mm labels.
   */
  setHorzScale(behavior: HorzScaleBehavior): void {
    if (behavior instanceof TimeScaleBehavior) {
      behavior.setResolution(this._resolution);
      // Carry the active locale's date formatter onto a host-supplied time
      // scale so its axis labels localize too (no-op / cleared when no locale).
      const i18n = this._i18n;
      behavior.setDateFormatter(
        i18n.locale === undefined ? null : (t: number, res: string) => i18n.date(t, res),
      );
    }
    this._horzScale = behavior;
    this.requestRender();
  }

  /** The active horizontal-scale behavior. */
  get horzScale(): HorzScaleBehavior {
    return this._horzScale;
  }

  setPriceFormat(fn?: (price: number) => string): void {
    this._priceFormat = fn;
  }

  setVolumeFormat(fn?: (price: number) => string): void {
    this._volumeFormat = fn;
  }

  /**
   * Install the localization bundle (C6). Updates the canvas `aria-label`
   * immediately and requests a render so legend labels / the go-to-live pill
   * pick up the new strings. Passing the result of a no-locale `createI18n()`
   * restores the default English, locale-agnostic behavior.
   *
   * Host-supplied `priceFormat` / `volumeFormat` still take priority over the
   * bundle's locale-aware number formatters (see `_legendPriceFormat` etc.) —
   * i18n only fills in where the host hasn't overridden formatting.
   */
  setI18n(i18n: I18n): void {
    this._i18n = i18n;
    this._applyAriaLabel();
    // Localize time-axis labels (and, transitively, the crosshair time label /
    // a11y announcement, which flow from horzScale.formatValue) when a locale
    // is set. With no locale, clear the override so labels stay byte-for-byte
    // the legacy formatTime output. Only TimeScaleBehavior-based scales carry
    // a date formatter; a custom (price/yield) scale is left untouched.
    const dateFmt = i18n.locale === undefined ? null : (t: number, res: string) => i18n.date(t, res);
    this._timeScale.setDateFormatter(dateFmt);
    if (this._horzScale instanceof TimeScaleBehavior && this._horzScale !== this._timeScale) {
      this._horzScale.setDateFormatter(dateFmt);
    }
    this.requestRender();
  }

  /** The active localization bundle. */
  get i18n(): I18n {
    return this._i18n;
  }

  /** Write the current localized `aria-label` (`label` + `hint`) to the canvas. */
  private _applyAriaLabel(): void {
    const label = this._i18n.t('a11yChartLabel');
    const hint = this._i18n.t('a11yChartHint');
    // Join with a space, tolerating an empty hint (host may clear it).
    const text = hint ? `${label} ${hint}` : label;
    this._crosshairCanvas.setAttribute('aria-label', text);
  }

  /**
   * Effective price formatter for chrome (legend / a11y announcement):
   * host-supplied `priceFormat` wins, else the i18n bundle's locale-aware
   * price formatter (which, with no locale, IS the default `formatPrice`).
   */
  private _effPriceFormat(): (price: number) => string {
    return this._priceFormat ?? this._i18n.price;
  }

  /**
   * Effective volume formatter for the legend: host-supplied `volumeFormat`
   * wins, else the i18n bundle's locale-aware volume formatter (default
   * `formatVolume` when no locale).
   */
  private _effVolumeFormat(): (volume: number) => string {
    return this._volumeFormat ?? this._i18n.volume;
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

  /** Switch the primary price-series rendering style (built-in or custom). */
  setChartType(chartType: string): void {
    if (this._chartType === chartType) return;
    this._chartType = chartType;
    this.requestRender();
  }

  get chartType(): string {
    return this._chartType;
  }

  /**
   * Replace the indicator set. Indicators with `placement: 'overlay'`
   * are drawn on top of the price series in deterministic palette
   * order. Indicators with `placement: 'pane'` are not yet rendered
   * (pane layout integration is a future phase) — they still compute
   * their values, which is useful for code paths that want to read
   * `getIndicatorSeries(id)` without rendering.
   */
  setIndicators(indicators: Indicator[]): void {
    const prevPaneCount = this._paneIndicatorCount();
    const prevHasLeft = this._hasLeftScaleIndicator();
    this._indicators = indicators;
    // Recompute the layout if either the sub-pane count (panes consume
    // vertical space) or the presence of a left-scale binding (B2: the left
    // axis strip consumes horizontal space) changed.
    const nextPaneCount = this._paneIndicatorCount();
    const nextHasLeft = this._hasLeftScaleIndicator();
    if ((nextPaneCount !== prevPaneCount || nextHasLeft !== prevHasLeft) && this._layout) {
      this._layout = computeLayout(
        this._layout.width,
        this._layout.height,
        nextPaneCount,
        nextHasLeft,
      );
      this.viewport.setLayout(this._layout);
    }
    this.requestRender();
  }

  private _paneIndicatorCount(): number {
    let n = 0;
    for (const ind of this._indicators) if (ind.placement === 'pane') n++;
    return n;
  }

  /**
   * True when at least one OVERLAY indicator is bound to the secondary
   * (left) price scale (B2). Drives whether the layout reserves a left
   * axis strip; pane indicators own their own axis and never count.
   */
  private _hasLeftScaleIndicator(): boolean {
    for (const ind of this._indicators) {
      if (ind.placement === 'overlay' && ind.priceScaleId === 'left') return true;
    }
    return false;
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

  /** The drawing layer currently being rendered, or null. */
  get drawingLayer(): DrawingLayer | null {
    return this._drawingLayer;
  }

  /** Replace the set of candle-anchored markers. */
  setMarkers(markers: Marker[]): void {
    this._markers = markers;
    this.requestRender();
  }

  /** The current markers, in draw order. */
  get markers(): readonly Marker[] {
    return this._markers;
  }

  /** Attach a programmatic overlay primitive (rendered at its z-tier). */
  attachPrimitive(primitive: Primitive): void {
    this._primitives.push(primitive);
    this.requestRender();
  }

  /** Detach a primitive by id. Returns true if one was removed. */
  detachPrimitive(id: string): boolean {
    const idx = this._primitives.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    this._primitives.splice(idx, 1);
    this.requestRender();
    return true;
  }

  /** The attached primitives, in attach order. */
  get primitives(): readonly Primitive[] {
    return this._primitives;
  }

  /**
   * Topmost primitive whose `hitTest` passes at (x, y) in CSS pixels,
   * searched in reverse paint order (last attached wins). Used to route
   * drags to draggable price lines.
   */
  hitTestPrimitives(x: number, y: number, tolerance?: number): Primitive | null {
    for (let i = this._primitives.length - 1; i >= 0; i--) {
      const p = this._primitives[i]!;
      if (p.hitTest && p.hitTest(x, y, this._layout, this.viewport, tolerance)) return p;
    }
    return null;
  }

  private _drawPrimitives(ctx: CanvasRenderingContext2D, tier: PrimitiveZOrder): void {
    for (const p of this._primitives) {
      // Pass the host price formatter so price-line pills match the axis.
      if (p.zOrder === tier) p.draw(ctx, this._layout, this.viewport, this._theme, this._priceFormat);
    }
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
      inMainPane: y <= this._layout.chartBottom,
    };
    // The legend (in the UI layer) only changes when the snapped candle
    // changes. Moving the cursor within a single candle just moves the
    // crosshair lines, so redraw only the cheap crosshair layer and skip
    // the UI layer (legend, price line, pill) until the candle changes.
    if (candle) {
      if (snapIndex !== this._lastLegendIndex) {
        this._lastLegendIndex = snapIndex;
        this._uiDirty = true;
      }
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
    this._scheduleRaf();
  }

  private _formatA11yAnnouncement(candle: Candle, timeLabel: string): string {
    // Host price formatter wins; otherwise the i18n bundle's price formatter
    // (default `formatPrice` when no locale is set). The open/high/low/close
    // words come from the message bundle so the announcement is translatable.
    const fmt = this._effPriceFormat();
    const t = this._i18n;
    return `${this._symbol} ${timeLabel}: ${t.t('a11yOpen')} ${fmt(candle.o)}, ${t.t('a11yHigh')} ${fmt(candle.h)}, ${t.t('a11yLow')} ${fmt(candle.l)}, ${t.t('a11yClose')} ${fmt(candle.c)}`;
  }

  /** Hide crosshair and show last candle in legend */
  hideCrosshair(): void {
    this._crosshairState.visible = false;
    // Reset so re-entering the chart always refreshes the legend, and mark
    // the UI layer dirty to revert the legend to the latest candle.
    this._lastLegendIndex = -1;
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

    this._layout = computeLayout(
      width,
      height,
      this._paneIndicatorCount(),
      this._hasLeftScaleIndicator(),
    );
    this.viewport.setLayout(this._layout);

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

  /**
   * Paint the full chart layer (grid → volume → primary series → overlay
   * indicators → markers → drawings → primitives → axes → time axis) into an
   * arbitrary 2D-context-like target.
   *
   * Extracted verbatim from `_render`'s `_chartDirty` block so the on-screen
   * path and the off-screen/SVG path share one source of truth. `_render`
   * still calls it with the live `_chartCtx`; {@link renderToContext} calls it
   * with an export sink (e.g. an SVG-recording shim). The target only needs
   * the subset of {@link CanvasRenderingContext2D} the renderers actually use.
   */
  private _paintChartLayer(
    ctx: CanvasRenderingContext2D,
    series: SeriesDefinition,
    drawView: CandleView,
  ): void {
    if (!this._buffer) return;
    const { width, height } = this._layout;
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = this._theme.background;
    ctx.fillRect(0, 0, width, height);

    // 'bottom' primitives sit behind the grid + series (e.g. watermark).
    this._drawPrimitives(ctx, 'bottom');

    // Grid → Volume → primary series (by chart type) → overlay indicators
    // → drawings → Axes. Drawings sit above indicators so a trend line
    // is visible on top of SMA/EMA/BB clutter.
    this._gridRenderer.render(ctx, this._layout, this.viewport, this._theme);
    this._volumeRenderer.render(ctx, this._layout, this.viewport, drawView, this._theme);

    // Primary price series via the registry (candles/line/area/ohlc/
    // heikinashi or a host-registered custom type).
    series.draw({
      ctx,
      layout: this._layout,
      viewport: this.viewport,
      view: drawView,
      theme: this._theme,
    });

    // Overlay indicators (drawn on the main price area).
    let colorIdx = 0;
    const paneIndicators: { indicator: Indicator; series: IndicatorSeries[] }[] = [];
    for (const indicator of this._indicators) {
      let series: IndicatorSeries[];
      try {
        // computeCached memoizes on the buffer revision, so indicators
        // recompute only when data changes — not on every render frame.
        series = indicator.computeCached(this._buffer);
      } catch (err) {
        // Indicator compute errors are non-fatal; report and skip this one.
        this._reporter?.report('indicator', err, false);
        continue;
      }
      if (indicator.placement === 'overlay') {
        // Project through the left scale when the indicator is bound to it
        // (B2); everything else uses the primary right scale as before.
        const side = indicator.priceScaleId === 'left' ? 'left' : 'right';
        for (const s of series) {
          const color = INDICATOR_COLORS[colorIdx % INDICATOR_COLORS.length]!;
          colorIdx++;
          this._overlayRenderer.render(ctx, this._layout, this.viewport, s, color, this._theme, side);
        }
      } else {
        paneIndicators.push({ indicator, series });
      }
    }

    // Markers sit above indicators; drawings sit above markers.
    this._markerRenderer.render(
      ctx, this._layout, this.viewport, this._buffer, this._markers, this._theme,
    );

    // Drawing layer on top of indicators + markers.
    if (this._drawingLayer) {
      this._drawingLayer.render(ctx, this._layout, this.viewport, this._theme);
    }

    // 'normal' primitives sit with the drawing layer, above the series.
    this._drawPrimitives(ctx, 'normal');

    this._priceAxisRenderer.render(ctx, this._layout, this.viewport, this._theme, this._effPriceFormat());

    // Secondary (left) price axis — drawn only while the strip is
    // reserved (an overlay indicator is bound to 'left'). B2.
    if (this._layout.leftAxisWidth > 0) {
      this._priceAxisRenderer.render(
        ctx, this._layout, this.viewport, this._theme, this._effPriceFormat(), 'left',
      );
    }

    // Sub-pane indicators. Each gets one band of equal height in
    // [paneAreaTop, paneAreaBottom]. Color cursor continues from
    // overlay indicators so legends are easier to map mentally.
    if (paneIndicators.length > 0 && this._layout.paneAreaBottom > this._layout.paneAreaTop) {
      const bandH =
        (this._layout.paneAreaBottom - this._layout.paneAreaTop) / paneIndicators.length;
      for (let i = 0; i < paneIndicators.length; i++) {
        const entry = paneIndicators[i]!;
        const top = this._layout.paneAreaTop + i * bandH;
        const bottom = top + bandH;
        const drawn = this._paneRenderer.render(
          ctx,
          this._layout,
          this.viewport,
          entry.series,
          top,
          bottom,
          entry.indicator.id,
          this._theme,
          colorIdx,
        );
        colorIdx += drawn;
      }
    }

    this._timeAxisRenderer.render(ctx, this._layout, this.viewport, this._buffer, this._horzScale, this._theme);
  }

  /**
   * Resolve the per-frame draw geometry for `series`: visible window slice,
   * non-uniform horizontal coordinate mapping (value scales), price autoscale,
   * secondary (left) scale extent, and conflation. Returns the `drawView` the
   * chart layer paints from. Pure side-effect-wise w.r.t. the viewport (it
   * configures mapping + ranges exactly as the inline `_render` code did), so
   * calling it from `_render` (live) or {@link renderToContext} (export) yields
   * identical geometry. Extracted verbatim from `_render` — no behavior change.
   */
  private _computeRenderGeometry(series: SeriesDefinition): CandleView {
    const buffer = this._buffer!;
    const effLen = this._effectiveLength();

    const start = Math.max(0, Math.floor(this.viewport.startIndex));
    const end = Math.min(effLen, Math.ceil(this.viewport.startIndex + this.viewport.visibleCount) + 1);
    // Visible end WITHOUT the +1 render-only bar — used for autoscale and the
    // non-uniform domain edge so an off-screen bar can't skew either.
    const visibleEnd = Math.min(
      effLen,
      Math.ceil(this.viewport.startIndex + this.viewport.visibleCount),
    );
    const rawView = buffer.sliceView(start, end);

    // Non-uniform horizontal geometry (value-based scales, e.g. yield curve):
    // install a per-index 0..1 mapping so bars sit at value-proportional X.
    // Uniform scales (default time/price) clear it, keeping index geometry
    // bit-for-bit unchanged.
    const hs = this._horzScale;
    if (!hs.uniform && hs.domainToCoord01) {
      // Bind to preserve `this`: a custom behavior's domainToCoord01 may read
      // instance options (spacing params, etc.); detaching it would lose them.
      const toCoord = hs.domainToCoord01.bind(hs);
      // Anchor the domain on the FRACTIONAL visible window edges
      // [startIndex, startIndex + visibleCount] via domainValueAt (which
      // interpolates between candles), so drag/wheel panning moves the curve
      // smoothly instead of snapping to whole candles. The right edge is the
      // visible extent (the fractional position, not the integer `end - 1`
      // that carries the +1 render-only bar). Both anchors clamp into the
      // effective (replay-capped) buffer so a value-based axis stops at the
      // replayed bar rather than reaching into not-yet-revealed history.
      const maxIdx = Math.max(0, effLen - 1);
      const leftIdx = Math.max(0, Math.min(maxIdx, this.viewport.startIndex));
      const rightIdx = Math.max(
        0,
        Math.min(maxIdx, this.viewport.startIndex + this.viewport.visibleCount),
      );
      const from = domainValueAt(hs, buffer, leftIdx);
      const to = domainValueAt(hs, buffer, rightIdx);
      if (Number.isFinite(from) && Number.isFinite(to)) {
        this.viewport.setCoordinateMapping((index) =>
          toCoord(domainValueAt(hs, buffer, index), from, to),
        );
      } else {
        this.viewport.setCoordinateMapping(null);
      }
    } else {
      this.viewport.setCoordinateMapping(null);
    }

    // Time → fractional-index resolver for time-keyed overlay primitives (C2
    // compare). Installed every frame against the live buffer so a primitive
    // can map its own timestamps onto the price axis via viewport.timeToX
    // without ever importing the buffer. Bound once here (cheap closure); the
    // default render path never calls it, so this is zero-cost unless a
    // consumer (the compare overlay) actually reads timeToX.
    this.viewport.setTimeToIndexResolver((t) => {
      const idx = this._timeToFractionalIndex(t);
      // Replay (C1): a compare point (C2) whose timestamp maps past the
      // revealed prefix must stay hidden — return NaN so `viewport.timeToX` is
      // NaN and the compare overlay skips it. With no cap active the index is
      // returned unchanged, so points extrapolated past the last real bar draw
      // exactly as before.
      return this._replayCap !== null && idx > effLen - 1 ? NaN : idx;
    });

    // Series transform (e.g. Heikin-Ashi) → autoscale → conflate → draw.
    // A series with a transformView or custom priceRange auto-scales from
    // its (transformed) view; everything else uses the raw, pyramid-
    // accelerated path. Either way priceMin/priceMax are set every frame.
    const baseView = series.transformView
      ? series.transformView(buffer, start, end)
      : rawView;
    if (series.transformView || series.priceRange) {
      // Scale from the VISIBLE bars only (exclude the +1 render bar), matching
      // the default path; the +1 bar stays in baseView for drawing.
      const scaleView = capView(baseView, visibleEnd - start);
      this.viewport.autoScaleFromView(buffer, scaleView, series.priceRange, effLen);
    } else {
      // Pass the effective length so autoscale never scans past the replay cap
      // (C1). With no cap effLen === buffer.length, so this is the exact
      // pre-replay call (the param defaults to buffer.length when undefined).
      this.viewport.autoScale(buffer, this._rangePyramid ?? undefined, effLen);
    }

    // Secondary (left) price scale (B2): if any overlay indicator is bound
    // to 'left', collect the min/max across their values over the VISIBLE
    // window and feed the independent left range. Skipped entirely (no
    // alloc, no scan) when nothing is bound to 'left', so the default path
    // is untouched. Errors here are non-fatal and reported like the overlay
    // compute path below.
    if (this._hasLeftScaleIndicator()) {
      let leftMin = Infinity;
      let leftMax = -Infinity;
      const lo = Math.max(0, Math.floor(this.viewport.startIndex));
      const hi = visibleEnd;
      for (const indicator of this._indicators) {
        if (indicator.placement !== 'overlay' || indicator.priceScaleId !== 'left') continue;
        let computed: IndicatorSeries[];
        try {
          computed = indicator.computeCached(buffer);
        } catch (err) {
          this._reporter?.report('indicator', err, false);
          continue;
        }
        for (const s of computed) {
          const values = s.values;
          const e = Math.min(hi, values.length);
          for (let i = lo; i < e; i++) {
            const v = values[i]!;
            if (!Number.isFinite(v)) continue;
            if (v < leftMin) leftMin = v;
            if (v > leftMax) leftMax = v;
          }
        }
      }
      // Only commit a real range; an all-NaN/empty window keeps the
      // previous left extrema (setLeftRange itself rejects non-finite).
      if (Number.isFinite(leftMin) && Number.isFinite(leftMax)) {
        this.viewport.setLeftRange(leftMin, leftMax);
      }
    }

    // Downsample to ~1 bar per pixel column when candles are sub-pixel
    // dense (true fit-all over millions of bars). A no-op at normal zoom:
    // returns `baseView` unchanged so the standard render path is untouched.
    return conflate(baseView, this.viewport, this._layout);
  }

  /**
   * Render the chart layer into a caller-supplied 2D-context-like sink — the
   * seam the vector SVG export ({@link chartEngineToSVG}) renders through.
   *
   * Runs the exact same per-frame geometry pipeline as a real render (visible
   * window, non-uniform coordinate mapping, autoscale, left-scale extent,
   * conflation) and then paints the chart layer via {@link _paintChartLayer},
   * so the SVG matches what's on screen. It does NOT touch the live canvases,
   * dirty flags, or the UI/crosshair layers — it's a pure read of current
   * state into the passed `ctx`.
   *
   * Kept dependency-free (no SVG-shim import here) so it adds nothing to the
   * base bundle; the shim lives in the separately-imported export module.
   * No-ops when no buffer is set.
   */
  renderToContext(ctx: CanvasRenderingContext2D): void {
    if (!this._buffer) return;
    const series = getSeriesType(this._chartType) ?? DEFAULT_SERIES;
    const drawView = this._computeRenderGeometry(series);
    this._paintChartLayer(ctx, series, drawView);
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

    // Resolve the active primary series (registry; unknown → candles).
    const series = getSeriesType(this._chartType) ?? DEFAULT_SERIES;

    // Replay-aware "present" length. Equals buffer.length unless a replay cap
    // is active (C1); everything that determines the visible window, autoscale
    // extent, and the last/latest candle reads this instead of buffer.length so
    // playback reveals history bar-by-bar. With no cap it === buffer.length, so
    // the default render path is bit-for-bit unchanged.
    const effLen = this._effectiveLength();

    // Per-frame geometry pipeline (visible window, non-uniform coordinate
    // mapping, autoscale, left-scale extent, conflation). Extracted so the
    // off-screen SVG path ({@link renderToContext}) reproduces it identically.
    const drawView = this._computeRenderGeometry(series);

    if (this._chartDirty) {
      this._chartDirty = false;
      this._paintChartLayer(this._chartCtx, series, drawView);
    }

    if (this._uiDirty) {
      this._uiDirty = false;
      const ctx = this._uiCtx;
      ctx.clearRect(0, 0, this._layout.width, this._layout.height);

      // Current price line + label. In replay the "current" candle is the last
      // REVEALED bar (effLen - 1), not the buffer's true last candle — so the
      // price line and its pill track playback. With no cap effLen ===
      // buffer.length and `candleAt(effLen - 1)` is the buffer's last candle,
      // so the close + bull/bear are identical to the pre-replay path.
      if (effLen > 0) {
        const lastCandle = this._buffer.candleAt(effLen - 1);
        const lastClose = lastCandle ? lastCandle.c : this._buffer.lastClose();
        const isBull = lastCandle ? lastCandle.c >= lastCandle.o : true;
        this._priceLineRenderer.render(ctx, this._layout, this.viewport, lastClose, this._theme);
        this._priceAxisRenderer.drawCurrentPrice(ctx, this._layout, this.viewport, lastClose, isBull, this._theme, this._effPriceFormat());
      }

      // Legend. Read the hovered candle fresh from the buffer (not a stale
      // snapshot) so a realtime tick updating the forming candle the user
      // is hovering refreshes its OHLC. Falls back to the latest REVEALED
      // candle (effLen - 1), so during replay the resting legend shows the
      // replayed bar rather than a not-yet-revealed future candle.
      const hoveredIndex = this._crosshairState.visible ? this._lastLegendIndex : -1;
      const legendCandle =
        hoveredIndex >= 0 && hoveredIndex < effLen
          ? this._buffer.candleAt(hoveredIndex)
          : effLen > 0
            ? this._buffer.candleAt(effLen - 1)
            : null;
      this._legendRenderer.render(
        ctx, this._layout, legendCandle, this._symbol, this._resolution, this._theme, this._priceFormat, this._volumeFormat, this._i18n.messages,
      );

      // Floating "Go to live" pill when the user has scrolled away from the live edge.
      if (!this.viewport.autoFollow && effLen > 0) {
        this.goToLiveRenderer.render(ctx, this._layout, this._theme, this._i18n.t('goToLive'));
      } else {
        this.goToLiveRenderer.hide();
      }

      // 'top' primitives paint above the chart on the UI layer (e.g. price
      // lines and their axis pills, above the series and indicators).
      this._drawPrimitives(ctx, 'top');
    }

    if (this._crosshairDirty) {
      this._crosshairDirty = false;
      const ctx = this._crosshairCtx;
      ctx.clearRect(0, 0, this._layout.width, this._layout.height);
      this._crosshairRenderer.render(ctx, this._layout, this.viewport, this._crosshairState, this._theme, this._effPriceFormat());
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
