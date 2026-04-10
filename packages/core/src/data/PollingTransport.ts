import type { Candle, DataFeedConfig, DataTransport, HistoryRequest } from '../types';
import type { ErrorReporter } from '../ErrorReporter';

export interface PollingTransportConfig {
  apiUrl: string;
  pollInterval?: number; // ms, default 5000
  parseResponse?: (data: unknown) => Candle[];
  /**
   * Optional error reporter. When provided, polling errors are dispatched
   * through it with `where: 'subscribe'`. Without a reporter, errors are
   * swallowed silently — so consumers of PollingTransport directly should
   * always wire one.
   */
  reporter?: ErrorReporter;
}

/** Default parser: expects { o: number[], h: number[], l: number[], c: number[], v: number[], t: number[] } */
function defaultParser(data: unknown): Candle[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as {
    o?: unknown;
    h?: unknown;
    l?: unknown;
    c?: unknown;
    v?: unknown;
    t?: unknown;
  };
  if (
    !Array.isArray(d.t) ||
    !Array.isArray(d.o) ||
    !Array.isArray(d.h) ||
    !Array.isArray(d.l) ||
    !Array.isArray(d.c) ||
    !Array.isArray(d.v)
  ) {
    return [];
  }
  const t = d.t as number[];
  const o = d.o as number[];
  const h = d.h as number[];
  const l = d.l as number[];
  const c = d.c as number[];
  const v = d.v as number[];
  const n = Math.min(t.length, o.length, h.length, l.length, c.length, v.length);
  const candles: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const ti = t[i];
    const oi = o[i];
    const hi = h[i];
    const li = l[i];
    const ci = c[i];
    const vi = v[i];
    if (
      typeof ti !== 'number' ||
      typeof oi !== 'number' ||
      typeof hi !== 'number' ||
      typeof li !== 'number' ||
      typeof ci !== 'number' ||
      typeof vi !== 'number'
    ) {
      continue;
    }
    candles.push({ o: oi, h: hi, l: li, c: ci, v: vi, t: ti });
  }
  return candles;
}

export class PollingTransport implements DataTransport {
  private _apiUrl: string;
  private _pollInterval: number;
  private _parseResponse: (data: unknown) => Candle[];
  private _reporter: ErrorReporter | null;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _pollInFlight = false;
  private _abortController: AbortController | null = null;
  private _onUpdate: ((candles: Candle[]) => void) | null = null;
  private _config: DataFeedConfig | null = null;

  constructor(config: PollingTransportConfig) {
    this._apiUrl = config.apiUrl;
    this._pollInterval = config.pollInterval ?? 5000;
    this._parseResponse = config.parseResponse ?? defaultParser;
    this._reporter = config.reporter ?? null;
  }

  /** Called by OHLCVChart if it wants to wire its own reporter after construction. */
  setReporter(reporter: ErrorReporter | null): void {
    this._reporter = reporter;
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
    } catch (error) {
      // Abort during unsubscribe is expected; report as non-fatal so
      // downstream loggers can still see it if they want.
      this._reporter?.report('subscribe', error, false);
    } finally {
      this._pollInFlight = false;
    }
  }
}
