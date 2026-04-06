import type { Candle, DataFeedConfig, DataTransport, HistoryRequest } from '../types';

export interface PollingTransportConfig {
  apiUrl: string;
  pollInterval?: number; // ms, default 5000
  parseResponse?: (data: unknown) => Candle[];
}

/** Default parser: expects { o: number[], h: number[], l: number[], c: number[], v: number[], t: number[] } */
function defaultParser(data: unknown): Candle[] {
  const d = data as { o: number[]; h: number[]; l: number[]; c: number[]; v: number[]; t: number[] };
  if (!d || !Array.isArray(d.t)) return [];
  const candles: Candle[] = [];
  for (let i = 0; i < d.t.length; i++) {
    candles.push({
      o: d.o[i],
      h: d.h[i],
      l: d.l[i],
      c: d.c[i],
      v: d.v[i],
      t: d.t[i],
    });
  }
  return candles;
}

export class PollingTransport implements DataTransport {
  private _apiUrl: string;
  private _pollInterval: number;
  private _parseResponse: (data: unknown) => Candle[];
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _pollInFlight = false;
  private _abortController: AbortController | null = null;
  private _onUpdate: ((candles: Candle[]) => void) | null = null;
  private _config: DataFeedConfig | null = null;

  constructor(config: PollingTransportConfig) {
    this._apiUrl = config.apiUrl;
    this._pollInterval = config.pollInterval ?? 5000;
    this._parseResponse = config.parseResponse ?? defaultParser;
  }

  async fetchHistory(req: HistoryRequest): Promise<Candle[]> {
    const url = `${this._apiUrl}?symbol=${encodeURIComponent(req.symbol)}&resolution=${encodeURIComponent(req.resolution)}&from=${req.from}&to=${req.to}`;
    const resp = await fetch(url, { signal: this._abortController?.signal });
    const data = await resp.json();
    return this._parseResponse(data);
  }

  subscribe(config: DataFeedConfig, onUpdate: (candles: Candle[]) => void): void {
    this.unsubscribe();
    this._config = config;
    this._onUpdate = onUpdate;
    this._abortController = new AbortController();

    this._pollTimer = setInterval(() => {
      this._poll();
    }, this._pollInterval);
  }

  unsubscribe(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    this._onUpdate = null;
    this._config = null;
    this._pollInFlight = false;
  }

  destroy(): void {
    this.unsubscribe();
  }

  /** Poll for latest data. Serialized via pollInFlight guard. */
  private async _poll(): Promise<void> {
    // CRITICAL: Don't abort previous poll, just skip this tick
    if (this._pollInFlight || !this._config || !this._onUpdate) return;
    this._pollInFlight = true;

    try {
      const now = Math.floor(Date.now() / 1000);
      const req: HistoryRequest = {
        symbol: this._config.symbol,
        resolution: this._config.resolution,
        from: now - 60, // last minute
        to: now,
      };
      const candles = await this.fetchHistory(req);
      this._onUpdate?.(candles);
    } catch {
      // Ignore errors (likely aborted or network failure)
    } finally {
      this._pollInFlight = false;
    }
  }
}
