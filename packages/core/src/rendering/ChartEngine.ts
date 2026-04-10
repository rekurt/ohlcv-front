import type { ThemeColors, ChartLayout, Candle } from '../types';
import { computeLayout, resizeHiDPICanvas, createHiDPICanvas, resolveTheme } from '../utils';
import type { CandleBuffer } from '../data/CandleBuffer';
import { Viewport } from '../interaction/Viewport';
import { GridRenderer } from './GridRenderer';
import { CandleRenderer } from './CandleRenderer';
import { VolumeRenderer } from './VolumeRenderer';
import { PriceAxisRenderer } from './PriceAxis';
import { TimeAxisRenderer } from './TimeAxis';
import { CrosshairRenderer, type CrosshairState } from './CrosshairRenderer';
import { PriceLineRenderer } from './PriceLineRenderer';
import { LegendRenderer } from './LegendRenderer';
import { GoToLiveRenderer } from './GoToLiveRenderer';

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
  private _symbol = '';
  private _resolution = '';
  private _priceFormat?: (price: number) => string;
  private _volumeFormat?: (volume: number) => string;

  // Renderers
  private _gridRenderer = new GridRenderer();
  private _candleRenderer = new CandleRenderer();
  private _volumeRenderer = new VolumeRenderer();
  private _priceAxisRenderer = new PriceAxisRenderer();
  private _timeAxisRenderer = new TimeAxisRenderer();
  private _crosshairRenderer = new CrosshairRenderer();
  private _priceLineRenderer = new PriceLineRenderer();
  private _legendRenderer = new LegendRenderer();
  readonly goToLiveRenderer = new GoToLiveRenderer();

  // State
  private _crosshairState: CrosshairState = { x: 0, y: 0, price: 0, time: '', visible: false };
  private _legendCandle: Candle | null = null;
  private _chartDirty = true;
  private _uiDirty = true;
  private _crosshairDirty = false;
  private _rafId = 0;
  private _resizeObserver: ResizeObserver | null = null;

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
    // Make the top canvas focusable so it can receive keyboard events.
    this._crosshairCanvas.tabIndex = 0;
    this._crosshairCanvas.style.outline = 'none';
    // Accessibility: label the interactive canvas as an application image
    // and describe its purpose. Screen readers that don't speak canvas
    // pixel content will at least announce "OHLCV price chart" on focus.
    this._crosshairCanvas.setAttribute('role', 'img');
    this._crosshairCanvas.setAttribute('aria-label', 'OHLCV price chart. Use arrow keys to pan, plus and minus to zoom, Home and End to jump.');

    container.appendChild(this._chartCanvas);
    container.appendChild(this._uiCanvas);
    container.appendChild(this._crosshairCanvas);

    this._chartCtx = this._chartCanvas.getContext('2d')!;
    this._uiCtx = this._uiCanvas.getContext('2d')!;
    this._crosshairCtx = this._crosshairCanvas.getContext('2d')!;

    this.viewport = new Viewport();
    this._layout = computeLayout(w, h);
    this.viewport.setLayout(this._layout);

    // ResizeObserver
    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) this.resize(width, height);
      }
    });
    this._resizeObserver.observe(container);
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
    if (candle) this._legendCandle = candle;
    this._crosshairDirty = true;
    this._uiDirty = true;
    this._scheduleRaf();
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
    this._layout = computeLayout(width, height);
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
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    this._chartCanvas.remove();
    this._uiCanvas.remove();
    this._crosshairCanvas.remove();
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

      // Grid → Volume → Candles → Axes
      this._gridRenderer.render(ctx, this._layout, this.viewport, this._theme);
      this._volumeRenderer.render(ctx, this._layout, this.viewport, view, this._theme);
      this._candleRenderer.render(ctx, this._layout, this.viewport, view, this._theme);
      this._priceAxisRenderer.render(ctx, this._layout, this.viewport, this._theme, this._priceFormat);
      this._timeAxisRenderer.render(ctx, this._layout, this.viewport, this._buffer, this._resolution, this._theme);
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
      this._crosshairRenderer.render(ctx, this._layout, this.viewport, this._crosshairState, this._theme, this._priceFormat);
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
