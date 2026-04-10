import { WebSocketTransport } from './WebSocketTransport';
import { ExponentialBackoff } from './ExponentialBackoff';
import type { ErrorReporter } from '../ErrorReporter';
import type { Candle, DataFeedConfig, HistoryRequest } from '../types';

/**
 * WebSocket transport for Binance public kline streams.
 *
 * Wire format (https://binance-docs.github.io/apidocs/spot/en/#kline-candlestick-streams):
 *   - Stream URL: wss://stream.binance.com:9443/ws/{symbol}@kline_{interval}
 *   - Resolution mapping: 1m/3m/5m/15m/30m/1h/2h/4h/6h/8h/12h/1d/3d/1w/1M
 *   - Messages arrive as { e, E, s, k: { t, o, h, l, c, v, ... } }
 *
 * History fetched via REST: GET https://api.binance.com/api/v3/klines
 *
 * This is an **unverified skeleton**. It wires the shape of the adapter,
 * has tests against mock WebSockets, and integrates with the
 * ExponentialBackoff for reconnection. Wire-level validation against the
 * live Binance server is deferred — a future session should run it end-to-end
 * against a testnet symbol.
 */
export interface BinanceWsTransportOptions {
  /** Override base WS URL (for testing). Default: wss://stream.binance.com:9443/ws */
  wsUrl?: string;
  /** Override base REST URL (for testing). Default: https://api.binance.com */
  restUrl?: string;
  /**
   * Factory used to construct the WebSocket. Defaults to `globalThis.WebSocket`.
   * Injected by tests to replace with a mock.
   */
  webSocketFactory?: (url: string) => IWebSocketLike;
  /** Fetch implementation for REST calls. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** ErrorReporter for structured error dispatch. */
  reporter?: ErrorReporter;
  /** Backoff policy for reconnect attempts. */
  backoff?: ExponentialBackoff;
  /** Schedule function for retries (setTimeout-like). Tests inject fakes. */
  scheduleRetry?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Cancel a scheduled retry. Defaults to clearTimeout. */
  cancelRetry?: (handle: ReturnType<typeof setTimeout>) => void;
}

/**
 * Narrow interface we need from a WebSocket. Allows mocking with a plain
 * object in tests without depending on dom lib WebSocket globals.
 */
export interface IWebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
}

const DEFAULT_WS_URL = 'wss://stream.binance.com:9443/ws';
const DEFAULT_REST_URL = 'https://api.binance.com';

/** Binance resolution strings for klines endpoint. */
const BINANCE_RESOLUTIONS: ReadonlyMap<string, string> = new Map([
  ['1m', '1m'], ['3m', '3m'], ['5m', '5m'], ['15m', '15m'], ['30m', '30m'],
  ['1H', '1h'], ['1h', '1h'], ['2h', '2h'], ['4H', '4h'], ['4h', '4h'],
  ['6h', '6h'], ['8h', '8h'], ['12h', '12h'], ['1D', '1d'], ['1d', '1d'],
  ['3d', '3d'], ['1W', '1w'], ['1w', '1w'], ['1M', '1M'],
]);

export class BinanceWsTransport extends WebSocketTransport {
  private readonly _options: Required<Omit<BinanceWsTransportOptions, 'reporter' | 'backoff' | 'scheduleRetry' | 'cancelRetry' | 'webSocketFactory' | 'fetchImpl'>> & {
    webSocketFactory: (url: string) => IWebSocketLike;
    fetchImpl: typeof fetch;
    reporter: ErrorReporter | null;
    backoff: ExponentialBackoff;
    scheduleRetry: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    cancelRetry: (handle: ReturnType<typeof setTimeout>) => void;
  };

  private _ws: IWebSocketLike | null = null;
  private _retryHandle: ReturnType<typeof setTimeout> | null = null;
  private _closed = false;
  private _currentConfig: DataFeedConfig | null = null;

  constructor(options: BinanceWsTransportOptions = {}) {
    super();
    this._options = {
      wsUrl: options.wsUrl ?? DEFAULT_WS_URL,
      restUrl: options.restUrl ?? DEFAULT_REST_URL,
      webSocketFactory:
        options.webSocketFactory ??
        ((url: string) => new (globalThis as { WebSocket: new (url: string) => IWebSocketLike }).WebSocket(url)),
      fetchImpl: options.fetchImpl ?? globalThis.fetch.bind(globalThis),
      reporter: options.reporter ?? null,
      backoff: options.backoff ?? new ExponentialBackoff(),
      scheduleRetry: options.scheduleRetry ?? ((fn, ms) => setTimeout(fn, ms)),
      cancelRetry: options.cancelRetry ?? clearTimeout,
    };
  }

  /** REST: fetch historical klines for the requested range. */
  override async fetchHistory(req: HistoryRequest): Promise<Candle[]> {
    const interval = mapResolution(req.resolution);
    if (!interval) {
      throw new Error(`Binance: unsupported resolution ${req.resolution}`);
    }
    const url =
      `${this._options.restUrl}/api/v3/klines` +
      `?symbol=${encodeURIComponent(req.symbol)}` +
      `&interval=${interval}` +
      `&startTime=${req.from * 1000}` +
      `&endTime=${req.to * 1000}` +
      `&limit=1000`;

    const resp = await this._options.fetchImpl(url);
    if (!resp.ok) {
      throw new Error(`Binance REST ${resp.status}: ${resp.statusText}`);
    }
    const data: unknown = await resp.json();
    return parseBinanceKlines(data);
  }

  override connect(url: string): void {
    if (this._closed) return;
    this._ws = this._options.webSocketFactory(url);

    this._ws.onopen = () => {
      this._options.backoff.reset();
    };
    this._ws.onmessage = (ev) => {
      try {
        const payload = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
        const candles = parseBinanceKlineMessage(payload);
        if (candles.length > 0) {
          this._onUpdate?.(candles);
        }
      } catch (error) {
        this._options.reporter?.report('parseCandles', error, false);
      }
    };
    this._ws.onerror = (err) => {
      this._options.reporter?.report('subscribe', err instanceof Error ? err : new Error('ws error'), false);
    };
    this._ws.onclose = () => {
      if (this._closed) return;
      // Reconnect with exponential backoff if we still have a subscription.
      if (this._currentConfig) {
        const delay = this._options.backoff.nextDelay();
        this._retryHandle = this._options.scheduleRetry(() => {
          this._retryHandle = null;
          if (this._currentConfig) this.connect(url);
        }, delay);
      }
    };
  }

  override subscribeChannel(channel: string, _handler: (data: unknown) => void): void {
    // Binance uses path-based channels: URL already contains the stream
    // (`/ws/{symbol}@kline_{interval}`). Nothing to send after connect.
    const url = `${this._options.wsUrl}/${channel}`;
    this.connect(url);
  }

  override unsubscribeChannel(_channel: string): void {
    if (this._retryHandle !== null) {
      this._options.cancelRetry(this._retryHandle);
      this._retryHandle = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }

  /** Override subscribe to build a Binance-shaped channel name. */
  override subscribe(config: DataFeedConfig, onUpdate: (candles: Candle[]) => void): void {
    this._closed = false;
    this._currentConfig = config;
    this._onUpdate = onUpdate;
    const interval = mapResolution(config.resolution);
    if (!interval) {
      this._options.reporter?.report(
        'subscribe',
        new Error(`Binance: unsupported resolution ${config.resolution}`),
        true,
      );
      return;
    }
    const channel = `${config.symbol.toLowerCase()}@kline_${interval}`;
    this.subscribeChannel(channel, () => {});
  }

  override unsubscribe(): void {
    this._currentConfig = null;
    this._onUpdate = null;
    if (this._retryHandle !== null) {
      this._options.cancelRetry(this._retryHandle);
      this._retryHandle = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }

  override destroy(): void {
    this._closed = true;
    this.unsubscribe();
  }
}

/** Map an `@ohlcv` resolution string to a Binance kline interval. */
function mapResolution(resolution: string): string | null {
  return BINANCE_RESOLUTIONS.get(resolution) ?? null;
}

/**
 * Parse Binance REST /api/v3/klines response.
 * Response shape: Array<[openTime, open, high, low, close, volume, closeTime, ...]>
 */
function parseBinanceKlines(data: unknown): Candle[] {
  if (!Array.isArray(data)) return [];
  const out: Candle[] = [];
  for (const row of data) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [openTime, o, h, l, c, v] = row as [number, string, string, string, string, string];
    const oo = Number(o);
    const hh = Number(h);
    const ll = Number(l);
    const cc = Number(c);
    const vv = Number(v);
    if (![openTime, oo, hh, ll, cc, vv].every((x) => Number.isFinite(x))) continue;
    out.push({ o: oo, h: hh, l: ll, c: cc, v: vv, t: Math.floor(openTime / 1000) });
  }
  return out;
}

/** Parse a single kline push message from the WS stream. */
function parseBinanceKlineMessage(data: unknown): Candle[] {
  if (!data || typeof data !== 'object') return [];
  const msg = data as { k?: { t?: number; o?: string; h?: string; l?: string; c?: string; v?: string } };
  if (!msg.k) return [];
  const k = msg.k;
  if (k.t === undefined) return [];
  const o = Number(k.o);
  const h = Number(k.h);
  const l = Number(k.l);
  const c = Number(k.c);
  const v = Number(k.v);
  if (![k.t, o, h, l, c, v].every((x) => Number.isFinite(x))) return [];
  return [{ o, h, l, c, v, t: Math.floor(k.t / 1000) }];
}
