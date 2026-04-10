import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BinanceWsTransport, type IWebSocketLike } from './BinanceWsTransport';
import { ExponentialBackoff } from './ExponentialBackoff';
import { ErrorReporter } from '../ErrorReporter';
import type { Candle, ChartError } from '../types';

/**
 * In-test WebSocket mock. Captures the last created instance and lets
 * tests drive onopen/onmessage/onclose callbacks manually.
 */
class MockWebSocket implements IWebSocketLike {
  static instances: MockWebSocket[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  closed = false;
  sentMessages: string[] = [];
  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sentMessages.push(data);
  }
  close(): void {
    this.closed = true;
    this.onclose?.({});
  }
  fire(event: 'open' | 'message' | 'error' | 'close', payload?: unknown): void {
    if (event === 'open') this.onopen?.({});
    if (event === 'message') this.onmessage?.({ data: payload });
    if (event === 'error') this.onerror?.(payload);
    if (event === 'close') this.onclose?.(payload);
  }
}

describe('BinanceWsTransport', () => {
  let errors: ChartError[];
  let reporter: ErrorReporter;
  let retries: Array<{ fn: () => void; ms: number }>;
  let scheduleRetry: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  let cancelRetry: (handle: ReturnType<typeof setTimeout>) => void;

  beforeEach(() => {
    MockWebSocket.instances = [];
    errors = [];
    reporter = new ErrorReporter((e) => errors.push(e));
    retries = [];
    let nextHandle = 1;
    scheduleRetry = (fn, ms) => {
      retries.push({ fn, ms });
      return nextHandle++ as unknown as ReturnType<typeof setTimeout>;
    };
    cancelRetry = () => {
      /* tests manually inspect the retries array */
    };
  });

  function factory(url: string): IWebSocketLike {
    return new MockWebSocket(url);
  }

  function build(): BinanceWsTransport {
    return new BinanceWsTransport({
      webSocketFactory: factory,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      reporter,
      backoff: new ExponentialBackoff({ baseDelay: 100, maxDelay: 1000, rng: () => 1 }),
      scheduleRetry,
      cancelRetry,
    });
  }

  describe('subscribe', () => {
    it('opens a websocket with the correct channel URL', () => {
      const t = build();
      t.subscribe({ symbol: 'BTCUSDT', resolution: '1m' }, () => {});
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0]!.url).toContain('btcusdt@kline_1m');
    });

    it('maps @ohlcv resolution to Binance interval for uppercase H/D', () => {
      const t = build();
      t.subscribe({ symbol: 'ETHUSDT', resolution: '1H' }, () => {});
      expect(MockWebSocket.instances[0]!.url).toContain('ethusdt@kline_1h');
      t.unsubscribe();

      t.subscribe({ symbol: 'ETHUSDT', resolution: '1D' }, () => {});
      expect(MockWebSocket.instances[1]!.url).toContain('ethusdt@kline_1d');
    });

    it('reports fatal error for unsupported resolution', () => {
      const t = build();
      t.subscribe({ symbol: 'BTCUSDT', resolution: 'weird' }, () => {});
      const err = errors.find((e) => /weird/.test(e.error.message));
      expect(err).toBeTruthy();
      expect(err!.fatal).toBe(true);
      expect(MockWebSocket.instances).toHaveLength(0);
    });

    it('onmessage parses kline payload and forwards candles to onUpdate', () => {
      const t = build();
      const received: Candle[][] = [];
      t.subscribe({ symbol: 'BTCUSDT', resolution: '1m' }, (candles) => received.push(candles));

      const ws = MockWebSocket.instances[0]!;
      ws.fire('open');
      ws.fire(
        'message',
        JSON.stringify({
          e: 'kline',
          k: {
            t: 1_700_000_000_000,
            o: '42000.00',
            h: '42100.00',
            l: '41900.00',
            c: '42050.00',
            v: '123.45',
          },
        }),
      );

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual([
        { o: 42000, h: 42100, l: 41900, c: 42050, v: 123.45, t: 1_700_000_000 },
      ]);
    });

    it('ignores messages without k field', () => {
      const t = build();
      const received: Candle[][] = [];
      t.subscribe({ symbol: 'BTCUSDT', resolution: '1m' }, (candles) => received.push(candles));

      const ws = MockWebSocket.instances[0]!;
      ws.fire('message', JSON.stringify({ e: 'pong' }));
      expect(received).toHaveLength(0);
    });

    it('reports parse errors through the reporter', () => {
      const t = build();
      t.subscribe({ symbol: 'BTCUSDT', resolution: '1m' }, () => {});

      const ws = MockWebSocket.instances[0]!;
      ws.fire('message', '{invalid-json');

      expect(errors.some((e) => e.where === 'parseCandles')).toBe(true);
    });
  });

  describe('reconnect', () => {
    it('schedules a reconnect via backoff after onclose', () => {
      const t = build();
      t.subscribe({ symbol: 'BTCUSDT', resolution: '1m' }, () => {});
      const ws = MockWebSocket.instances[0]!;

      // Simulate a disconnect
      ws.onclose?.({});

      expect(retries).toHaveLength(1);
      // First delay with baseDelay=100, rng=1, attempt=0 → 100
      expect(retries[0]!.ms).toBe(100);
    });

    it('reconnection creates a new websocket when the retry fires', () => {
      const t = build();
      t.subscribe({ symbol: 'BTCUSDT', resolution: '1m' }, () => {});
      const first = MockWebSocket.instances[0]!;

      first.onclose?.({});
      expect(retries).toHaveLength(1);
      // Fire the scheduled retry manually
      retries[0]!.fn();

      expect(MockWebSocket.instances).toHaveLength(2);
      const second = MockWebSocket.instances[1]!;
      expect(second.url).toBe(first.url);
    });

    it('successful reconnect (onopen) resets the backoff', () => {
      const backoff = new ExponentialBackoff({ baseDelay: 100, rng: () => 1 });
      const t = new BinanceWsTransport({
        webSocketFactory: factory,
        fetchImpl: vi.fn() as unknown as typeof fetch,
        reporter,
        backoff,
        scheduleRetry,
        cancelRetry,
      });
      t.subscribe({ symbol: 'BTCUSDT', resolution: '1m' }, () => {});

      const ws = MockWebSocket.instances[0]!;
      ws.onclose?.({});
      retries[0]!.fn();
      const second = MockWebSocket.instances[1]!;

      // Before open: backoff advanced once
      expect(backoff.attempts).toBe(1);
      second.fire('open');
      // After successful open: backoff reset
      expect(backoff.attempts).toBe(0);
    });

    it('destroy cancels pending reconnect', () => {
      const cancelled: unknown[] = [];
      const t = new BinanceWsTransport({
        webSocketFactory: factory,
        fetchImpl: vi.fn() as unknown as typeof fetch,
        reporter,
        backoff: new ExponentialBackoff({ baseDelay: 100, rng: () => 1 }),
        scheduleRetry,
        cancelRetry: (h) => {
          cancelled.push(h);
        },
      });
      t.subscribe({ symbol: 'BTCUSDT', resolution: '1m' }, () => {});
      const ws = MockWebSocket.instances[0]!;
      ws.onclose?.({});
      expect(retries).toHaveLength(1);

      t.destroy();
      expect(cancelled).toHaveLength(1);
    });
  });

  describe('fetchHistory', () => {
    it('builds a correct REST URL and parses klines array', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: true,
        async json() {
          return [
            [1_700_000_000_000, '42000.0', '42100.0', '41900.0', '42050.0', '123.45'],
            [1_700_000_060_000, '42050.0', '42200.0', '42000.0', '42150.0', '234.56'],
          ];
        },
      }) as unknown as Response);

      const t = new BinanceWsTransport({
        webSocketFactory: factory,
        fetchImpl: mockFetch as unknown as typeof fetch,
        reporter,
      });
      const candles = await t.fetchHistory({
        symbol: 'BTCUSDT',
        resolution: '1m',
        from: 1_700_000_000,
        to: 1_700_000_120,
      });

      expect(candles).toHaveLength(2);
      expect(candles[0]).toEqual({
        o: 42000,
        h: 42100,
        l: 41900,
        c: 42050,
        v: 123.45,
        t: 1_700_000_000,
      });
      expect(mockFetch).toHaveBeenCalledOnce();
      const firstCall = mockFetch.mock.calls[0] as unknown[] | undefined;
      const url = firstCall?.[0];
      expect(String(url)).toContain('symbol=BTCUSDT');
      expect(String(url)).toContain('interval=1m');
    });

    it('rejects unsupported resolution', async () => {
      const t = build();
      await expect(
        t.fetchHistory({ symbol: 'BTCUSDT', resolution: 'weird', from: 0, to: 1 }),
      ).rejects.toThrow(/unsupported resolution/);
    });

    it('propagates non-OK HTTP errors', async () => {
      const mockFetch = vi.fn(async () => ({ ok: false, status: 500, statusText: 'Bad Gateway' })) as unknown as typeof fetch;
      const t = new BinanceWsTransport({
        webSocketFactory: factory,
        fetchImpl: mockFetch,
        reporter,
      });
      await expect(
        t.fetchHistory({ symbol: 'BTCUSDT', resolution: '1m', from: 0, to: 1 }),
      ).rejects.toThrow(/500/);
    });
  });
});
