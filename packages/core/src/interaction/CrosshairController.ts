import type { ChartEngine } from '../rendering/ChartEngine';
import type { CandleBuffer } from '../data/CandleBuffer';
import type { HoverInfo } from '../types';
import { formatTime, clamp } from '../utils';

export class CrosshairController {
  private _engine: ChartEngine;
  private _buffer: CandleBuffer;
  private _resolution: string;
  private _rafPending = false;
  private _lastX = 0;
  private _lastY = 0;
  private _onHover: ((info: HoverInfo | null) => void) | null = null;

  private _onMouseMove: (e: MouseEvent) => void;
  private _onMouseLeave: (e: MouseEvent) => void;

  constructor(engine: ChartEngine, buffer: CandleBuffer, resolution: string) {
    this._engine = engine;
    this._buffer = buffer;
    this._resolution = resolution;

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

  setResolution(resolution: string): void {
    this._resolution = resolution;
  }

  destroy(): void {
    const canvas = this._engine.topCanvas;
    canvas.removeEventListener('mousemove', this._onMouseMove);
    canvas.removeEventListener('mouseleave', this._onMouseLeave);
  }

  private _handleMouseMove(e: MouseEvent): void {
    const rect = this._engine.topCanvas.getBoundingClientRect();
    this._lastX = e.clientX - rect.left;
    this._lastY = e.clientY - rect.top;

    if (!this._rafPending) {
      this._rafPending = true;
      requestAnimationFrame(() => {
        this._rafPending = false;
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

    // Only show crosshair in chart area
    if (x < layout.chartLeft || x > layout.chartRight || y < layout.chartTop || y > layout.chartBottom) {
      this._engine.hideCrosshair();
      this._onHover?.(null);
      return;
    }

    // Snap to nearest candle
    let index = viewport.xToIndex(x);
    index = clamp(index, 0, this._buffer.length - 1);

    const candle = this._buffer.candleAt(index);
    const snappedX = viewport.indexToX(index);
    const timeLabel = candle ? formatTime(candle.t, this._resolution) : '';

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
