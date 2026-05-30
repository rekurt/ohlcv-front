import type { ChartEngine } from '../rendering/ChartEngine';
import type { CandleBuffer } from '../data/CandleBuffer';
import type { HoverInfo } from '../types';
import { clamp } from '../utils';

export class CrosshairController {
  private _engine: ChartEngine;
  private _buffer: CandleBuffer;
  private _rafId = 0;
  private _destroyed = false;
  private _lastX = 0;
  private _lastY = 0;
  private _onHover: ((info: HoverInfo | null) => void) | null = null;

  private _onMouseMove: (e: MouseEvent) => void;
  private _onMouseLeave: (e: MouseEvent) => void;

  constructor(engine: ChartEngine, buffer: CandleBuffer) {
    this._engine = engine;
    this._buffer = buffer;

    const canvas = engine.topCanvas;
    canvas.style.cursor = 'crosshair';

    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onMouseLeave = this._handleMouseLeave.bind(this);

    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mouseleave', this._onMouseLeave);
  }

  /** Register a callback invoked on every snap-to-candle hover. */
  setOnHover(handler: ((info: HoverInfo | null) => void) | null): void {
    this._onHover = handler;
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

    // Snap to nearest candle
    let index = viewport.xToIndex(x);
    index = clamp(index, 0, this._buffer.length - 1);

    const candle = this._buffer.candleAt(index);
    const snappedX = viewport.indexToX(index);
    // Derive the X value via the behavior's fromLogical (exactly as the axis
    // does), not from candle.t directly — so a custom domain whose value
    // differs from the raw timestamp stays consistent between crosshair,
    // hover, and the rendered X axis.
    const horzValue = this._engine.horzScale.fromLogical(index, this._buffer);
    const timeLabel = horzValue !== null ? this._engine.horzScale.formatValue(horzValue) : '';

    this._engine.setCrosshair(snappedX, y, index, candle, timeLabel);

    if (candle && this._onHover) {
      this._onHover({
        candle,
        index,
        cursorPrice: viewport.yToPrice(y),
        timeLabel,
      });
    }
  }
}
