import type { ChartEngine } from '../rendering/ChartEngine';
import type { CandleBuffer } from '../data/CandleBuffer';
import type { Candle, CrosshairMode, HoverInfo, HoveredObject } from '../types';
import type { Viewport } from './Viewport';
import { clamp } from '../utils';

export class CrosshairController {
  private _engine: ChartEngine;
  private _buffer: CandleBuffer;
  private _rafId = 0;
  private _destroyed = false;
  private _lastX = 0;
  private _lastY = 0;
  private _mode: CrosshairMode = 'normal';
  private _onHover: ((info: HoverInfo | null) => void) | null = null;
  private _onDblClick: ((info: HoverInfo | null) => void) | null = null;

  private _onMouseMove: (e: MouseEvent) => void;
  private _onMouseLeave: (e: MouseEvent) => void;
  private _onDblClickEvent: (e: MouseEvent) => void;

  constructor(engine: ChartEngine, buffer: CandleBuffer) {
    this._engine = engine;
    this._buffer = buffer;

    const canvas = engine.topCanvas;
    canvas.style.cursor = 'crosshair';

    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onMouseLeave = this._handleMouseLeave.bind(this);
    this._onDblClickEvent = this._handleDblClick.bind(this);

    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mouseleave', this._onMouseLeave);
    canvas.addEventListener('dblclick', this._onDblClickEvent);
  }

  /** Register a callback invoked on every snap-to-candle hover. */
  setOnHover(handler: ((info: HoverInfo | null) => void) | null): void {
    this._onHover = handler;
  }

  /**
   * Register a callback invoked on every double-click over the plot area.
   * The payload is the `HoverInfo` for the cursor position, or `null` when
   * the cursor is outside the plot. Additive only — the chart's built-in
   * double-click handlers (fit / reset price scale) are unaffected.
   */
  setOnDblClick(handler: ((info: HoverInfo | null) => void) | null): void {
    this._onDblClick = handler;
  }

  /**
   * Set crosshair mode. In `'magnet'` mode the horizontal line snaps to the
   * nearest OHLC level of the candle under the cursor; `'normal'` follows the
   * raw cursor Y.
   */
  setMode(mode: CrosshairMode): void {
    this._mode = mode;
  }

  setBuffer(buffer: CandleBuffer): void {
    this._buffer = buffer;
  }

  destroy(): void {
    this._destroyed = true;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
    const canvas = this._engine.topCanvas;
    canvas.removeEventListener('mousemove', this._onMouseMove);
    canvas.removeEventListener('mouseleave', this._onMouseLeave);
    canvas.removeEventListener('dblclick', this._onDblClickEvent);
  }

  private _handleMouseMove(e: MouseEvent): void {
    if (this._destroyed) return;
    const rect = this._engine.topCanvas.getBoundingClientRect();
    this._lastX = e.clientX - rect.left;
    this._lastY = e.clientY - rect.top;

    if (this._rafId === 0) {
      this._rafId = requestAnimationFrame(() => {
        this._rafId = 0;
        if (this._destroyed) return;
        this._updateCrosshair();
      });
    }
  }

  private _handleMouseLeave(_e: MouseEvent): void {
    this._engine.hideCrosshair();
    this._onHover?.(null);
  }

  private _handleDblClick(e: MouseEvent): void {
    if (this._destroyed || !this._onDblClick) return;
    const rect = this._engine.topCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Build the HoverInfo for the cursor position using the same assembly as
    // the crosshair. Outside the plot → null payload. Crosshair Y is the raw
    // cursor Y here (a double-click is an instantaneous gesture, not a
    // sustained magnet hover), matching the cursorPrice a click would report.
    this._onDblClick(this._buildHoverInfo(x, y, y));
  }

  private _updateCrosshair(): void {
    const viewport = this._engine.viewport;
    const layout = this._engine.layout;
    const x = this._lastX;
    const y = this._lastY;

    // Show the crosshair across the whole plot area — the main price pane
    // plus any indicator sub-panes (down to paneAreaBottom) — so the user
    // can read pane indicator values at the hovered time index.
    if (x < layout.chartLeft || x > layout.chartRight || y < layout.chartTop || y > layout.paneAreaBottom) {
      this._engine.hideCrosshair();
      this._onHover?.(null);
      return;
    }

    // Snap to nearest candle (bounded by the replay cap when active).
    let index = viewport.xToIndex(x);
    index = clamp(index, 0, this._maxIndex());

    const candle = this._buffer.candleAt(index);
    const snappedX = viewport.indexToX(index);
    const timeLabel = this._timeLabelAt(index);

    // In magnet mode, snap the horizontal line to the nearest OHLC level of
    // the hovered candle; otherwise follow the raw cursor Y.
    const crosshairY =
      this._mode === 'magnet' && candle ? this._magnetY(candle, y, viewport) : y;

    this._engine.setCrosshair(snappedX, crosshairY, index, candle, timeLabel);

    if (candle && this._onHover) {
      this._onHover(this._buildHoverInfo(x, y, crosshairY));
    }
  }

  /**
   * Time-axis label for a snapped buffer index. Derives the X value via the
   * behavior's `fromLogical` (exactly as the axis does), not from `candle.t`
   * directly — so a custom domain whose value differs from the raw timestamp
   * stays consistent between crosshair, hover, and the rendered X axis.
   */
  private _timeLabelAt(index: number): string {
    const horzValue = this._engine.horzScale.fromLogical(index, this._buffer);
    return horzValue !== null ? this._engine.horzScale.formatValue(horzValue) : '';
  }

  /**
   * Highest buffer index the cursor may resolve to. During replay (C1) only the
   * capped prefix is revealed, so hover / double-click / crosshair must not snap
   * to candles past the cap even though the buffer physically holds more. With
   * no cap active this is just the last buffer index.
   */
  private _maxIndex(): number {
    return this._engine.maxVisibleIndex();
  }

  /**
   * Assemble the `HoverInfo` payload for a cursor position. Returns `null`
   * when the cursor is outside the plot area or the snapped candle is
   * missing. `crosshairY` is the (possibly magnet-snapped) Y used to derive
   * `cursorPrice`; pass the raw cursor Y for click-style gestures. Shared by
   * `_updateCrosshair` and the double-click handler so both report the same
   * shape, including `paneIndex` and the topmost `hovered` object.
   */
  private _buildHoverInfo(x: number, y: number, crosshairY: number): HoverInfo | null {
    const viewport = this._engine.viewport;
    const layout = this._engine.layout;
    if (x < layout.chartLeft || x > layout.chartRight || y < layout.chartTop || y > layout.paneAreaBottom) {
      return null;
    }
    let index = viewport.xToIndex(x);
    index = clamp(index, 0, this._maxIndex());
    const candle = this._buffer.candleAt(index);
    if (!candle) return null;

    return {
      candle,
      index,
      cursorPrice: viewport.yToPrice(crosshairY),
      timeLabel: this._timeLabelAt(index),
      paneIndex: this._paneIndexAt(y),
      hovered: this._hitTest(x, y),
    };
  }

  /**
   * Resolve which pane the cursor Y sits in. `0` is the main price pane
   * (down to `chartBottom`); indicator sub-panes split the band
   * `[paneAreaTop, paneAreaBottom]` into `paneCount` equal stripes numbered
   * `1..paneCount` top→bottom. Clamped so a Y exactly on `paneAreaBottom`
   * stays in the last pane.
   */
  private _paneIndexAt(y: number): number {
    const layout = this._engine.layout;
    if (layout.paneCount === 0 || y <= layout.chartBottom) return 0;
    const bandHeight = (layout.paneAreaBottom - layout.paneAreaTop) / layout.paneCount;
    if (bandHeight <= 0) return 0;
    const band = 1 + Math.floor((y - layout.paneAreaTop) / bandHeight);
    return clamp(band, 1, layout.paneCount);
  }

  /**
   * Topmost interactive object under the cursor, in priority order
   * drawing → primitive → marker. Drawings and primitives carry a stable
   * string `id`; marker hit-testing is not yet implemented (markers have no
   * pixel-geometry hit-test primitive), so it is never reported.
   */
  private _hitTest(x: number, y: number): HoveredObject | null {
    const drawingLayer = this._engine.drawingLayer;
    if (drawingLayer) {
      const hit = drawingLayer.hitTest(x, y, this._engine.layout, this._engine.viewport);
      if (hit) return { kind: 'drawing', id: hit.id };
    }
    const primitive = this._engine.hitTestPrimitives(x, y);
    if (primitive) return { kind: 'primitive', id: primitive.id };
    return null;
  }

  /** Y pixel of whichever of the candle's O/H/L/C sits closest to cursor Y. */
  private _magnetY(candle: Candle, y: number, viewport: Viewport): number {
    let bestY = y;
    let bestDist = Infinity;
    for (const price of [candle.o, candle.h, candle.l, candle.c]) {
      const py = viewport.priceToY(price);
      const dist = Math.abs(py - y);
      if (dist < bestDist) {
        bestDist = dist;
        bestY = py;
      }
    }
    return bestY;
  }
}
