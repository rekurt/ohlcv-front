import type { Candle } from '../types';
import type { CandleBuffer } from './CandleBuffer';

export class CandleMerger {
  private _buffer: CandleBuffer;
  private _onUpdate: ((info: { realtime: boolean }) => void) | null = null;
  private _rafId = 0;
  private _destroyed = false;
  /** Set when a realtime merge happened since the last coalesced frame. */
  private _pendingRealtime = false;

  constructor(buffer: CandleBuffer) {
    this._buffer = buffer;
  }

  setBuffer(buffer: CandleBuffer): void {
    this._buffer = buffer;
  }

  /**
   * Set the render callback (called at most once per frame). `info.realtime`
   * is true when the coalesced frame included at least one realtime merge
   * (`mergeRealtime`) — history loads (`loadHistory`) report `false` so
   * callers can scope behavior like max-candle eviction to live appends
   * and not undo a freshly-prepended history page.
   */
  onUpdate(callback: (info: { realtime: boolean }) => void): void {
    this._onUpdate = callback;
  }

  /**
   * Cancel any pending RAF and mark the merger as destroyed so late
   * frames produced by a prior `_scheduleUpdate` call don't fire
   * against torn-down state.
   */
  destroy(): void {
    this._destroyed = true;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
    this._onUpdate = null;
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
    this._pendingRealtime = true;
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
    if (this._destroyed || this._rafId !== 0 || !this._onUpdate) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = 0;
      if (this._destroyed) return;
      const realtime = this._pendingRealtime;
      this._pendingRealtime = false;
      this._onUpdate?.({ realtime });
    });
  }
}
