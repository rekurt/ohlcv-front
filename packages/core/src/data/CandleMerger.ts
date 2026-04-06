import type { Candle } from '../types';
import type { CandleBuffer } from './CandleBuffer';

export class CandleMerger {
  private _buffer: CandleBuffer;
  private _onUpdate: (() => void) | null = null;
  private _rafPending = false;

  constructor(buffer: CandleBuffer) {
    this._buffer = buffer;
  }

  setBuffer(buffer: CandleBuffer): void {
    this._buffer = buffer;
  }

  /** Set the render callback (called at most once per frame) */
  onUpdate(callback: () => void): void {
    this._onUpdate = callback;
  }

  /** Merge realtime candle updates */
  mergeRealtime(candles: Candle[]): void {
    for (const c of candles) {
      const lastTime = this._buffer.lastTime();
      if (lastTime > 0 && c.t === lastTime) {
        // Update existing forming candle
        this._buffer.updateLast(c);
      } else if (lastTime === 0 || c.t > lastTime) {
        // New candle
        this._buffer.append(c);
      }
      // Ignore candles older than the last one
    }
    this._scheduleUpdate();
  }

  /** Load historical candles */
  loadHistory(candles: Candle[]): void {
    if (candles.length === 0) return;

    if (this._buffer.length === 0) {
      // Empty buffer — just load everything
      this._buffer.appendBatch(candles);
    } else {
      // Filter out overlap: only prepend candles older than the first buffer time
      const firstTime = this._buffer.firstTime();
      const filtered = candles.filter((c) => c.t < firstTime);
      if (filtered.length > 0) {
        this._buffer.prepend(filtered);
      }
    }
    this._scheduleUpdate();
  }

  private _scheduleUpdate(): void {
    if (this._rafPending || !this._onUpdate) return;
    this._rafPending = true;
    requestAnimationFrame(() => {
      this._rafPending = false;
      this._onUpdate?.();
    });
  }
}
