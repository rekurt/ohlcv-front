import type { Candle, DataFeedConfig, DataTransport, HistoryRequest } from '../types';
import type { CandleBuffer } from './CandleBuffer';
import type { CandleMerger } from './CandleMerger';
import type { ErrorReporter } from '../ErrorReporter';

const HISTORY_WINDOW_SECONDS = 60 * 60 * 24 * 30; // 30 days

export class DataFeed {
  private _buffer: CandleBuffer;
  private _merger: CandleMerger;
  private _transport: DataTransport | null;
  private _reporter: ErrorReporter | null;
  private _config: DataFeedConfig | null = null;
  private _connectVersion = 0;
  private _isLoadingHistory = false;

  constructor(
    buffer: CandleBuffer,
    merger: CandleMerger,
    transport: DataTransport | null,
    reporter: ErrorReporter | null = null,
  ) {
    this._buffer = buffer;
    this._merger = merger;
    this._transport = transport;
    this._reporter = reporter;
  }

  setTransport(transport: DataTransport | null): void {
    this._transport = transport;
  }

  /** Connect to a symbol/resolution. Rejects stale responses via version counter. */
  async connect(config: DataFeedConfig): Promise<void> {
    this.disconnect();
    this._buffer.clear();
    this._config = config;
    const version = ++this._connectVersion;

    if (!this._transport) return;

    const now = Math.floor(Date.now() / 1000);
    const req: HistoryRequest = {
      symbol: config.symbol,
      resolution: config.resolution,
      from: now - HISTORY_WINDOW_SECONDS,
      to: now,
    };

    try {
      const candles = await this._transport.fetchHistory(req);
      // Stale check — symbol may have changed during fetch
      if (this._connectVersion !== version) return;
      this._merger.loadHistory(candles);
    } catch (error) {
      const isStale = this._connectVersion !== version;
      // Fatal when the user is still waiting on *this* connect — the chart
      // has no history to render. Non-fatal (just noise) for stale ones.
      this._reporter?.report('fetchHistory', error, !isStale);
      if (isStale) return;
    }

    // Subscribe to realtime updates. The callback's stale-version
    // check protects against late deliveries from a previous
    // subscription that wasn't cleanly torn down by the transport.
    // We also catch and report errors from `subscribe()` itself —
    // e.g., a WebSocket adapter that throws synchronously on a bad
    // symbol — so they don't reject the connect promise silently.
    if (this._connectVersion === version) {
      try {
        this._transport.subscribe(config, (candles: Candle[]) => {
          if (this._connectVersion !== version) return;
          try {
            this._merger.mergeRealtime(candles);
          } catch (mergeError) {
            // Per-tick merge errors are non-fatal — drop the tick,
            // keep streaming. A bad payload shouldn't kill the chart.
            this._reporter?.report('subscribe', mergeError, false);
          }
        });
      } catch (subscribeError) {
        this._reporter?.report('subscribe', subscribeError, false);
      }
    }
  }

  /** Load more historical data (for lazy loading on scroll-to-start) */
  async loadMoreHistory(): Promise<number> {
    if (!this._transport || !this._config || this._isLoadingHistory) return 0;
    this._isLoadingHistory = true;

    const version = this._connectVersion;
    const firstTime = this._buffer.firstTime();
    if (firstTime === 0) {
      this._isLoadingHistory = false;
      return 0;
    }

    const req: HistoryRequest = {
      symbol: this._config.symbol,
      resolution: this._config.resolution,
      from: firstTime - HISTORY_WINDOW_SECONDS,
      to: firstTime,
    };

    try {
      const lengthBefore = this._buffer.length;
      const candles = await this._transport.fetchHistory(req);

      // Stale check
      if (this._connectVersion !== version) {
        this._isLoadingHistory = false;
        return 0;
      }

      this._merger.loadHistory(candles);
      this._isLoadingHistory = false;

      // Return actual number added (not candles.length — merger filters overlap)
      return this._buffer.length - lengthBefore;
    } catch (error) {
      // Lazy loading failure is never fatal — the user keeps the data
      // they already have and can try panning back again later.
      this._reporter?.report('loadMoreHistory', error, false);
      this._isLoadingHistory = false;
      return 0;
    }
  }

  disconnect(): void {
    if (this._transport) {
      this._transport.unsubscribe();
    }
    this._config = null;
    // Bump the version so any in-flight fetchHistory whose await
    // resolves AFTER disconnect() runs is caught by the stale check
    // and doesn't write into the buffer. (Reconnect via `connect()`
    // already bumps the version, but a standalone disconnect()
    // previously left the version unchanged.)
    this._connectVersion++;
  }

  destroy(): void {
    this.disconnect();
    if (this._transport) {
      this._transport.destroy();
    }
  }
}
