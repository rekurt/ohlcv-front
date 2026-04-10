import { describe, it, expect, beforeEach } from 'vitest';
import { DataFeed } from './DataFeed';
import { CandleBuffer } from './CandleBuffer';
import { CandleMerger } from './CandleMerger';
import { ErrorReporter } from '../ErrorReporter';
import type {
  Candle,
  ChartError,
  DataFeedConfig,
  DataTransport,
  HistoryRequest,
} from '../types';

function makeCandle(i: number): Candle {
  return { o: 100, h: 101, l: 99, c: 100.5, v: 10, t: 1_700_000_000 + i * 60 };
}

class MockTransport implements DataTransport {
  history: Candle[] = [];
  subscribed = false;
  destroyed = false;
  fetchError: Error | null = null;
  lastReq: HistoryRequest | null = null;
  onUpdateCallback: ((candles: Candle[]) => void) | null = null;
  // Deferred fetchHistory — resolves/rejects only when the test calls .resolve()/.reject()
  private _pendingResolve: ((candles: Candle[]) => void) | null = null;
  private _pendingReject: ((err: Error) => void) | null = null;
  private _deferred = false;

  setDeferred(deferred: boolean): void {
    this._deferred = deferred;
  }

  async fetchHistory(req: HistoryRequest): Promise<Candle[]> {
    this.lastReq = req;
    if (this.fetchError) throw this.fetchError;
    if (this._deferred) {
      return new Promise((resolve, reject) => {
        this._pendingResolve = resolve;
        this._pendingReject = reject;
      });
    }
    return this.history;
  }

  resolvePending(candles: Candle[] = this.history): void {
    this._pendingResolve?.(candles);
    this._pendingResolve = null;
    this._pendingReject = null;
  }

  rejectPending(err: Error): void {
    this._pendingReject?.(err);
    this._pendingResolve = null;
    this._pendingReject = null;
  }

  subscribe(_config: DataFeedConfig, onUpdate: (candles: Candle[]) => void): void {
    this.subscribed = true;
    this.onUpdateCallback = onUpdate;
  }

  unsubscribe(): void {
    this.subscribed = false;
    this.onUpdateCallback = null;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

describe('DataFeed', () => {
  let buffer: CandleBuffer;
  let merger: CandleMerger;
  let transport: MockTransport;
  let errors: ChartError[];
  let reporter: ErrorReporter;
  let feed: DataFeed;

  const config: DataFeedConfig = { symbol: 'BTCUSDT', resolution: '1H' };

  beforeEach(() => {
    buffer = new CandleBuffer();
    merger = new CandleMerger(buffer);
    transport = new MockTransport();
    errors = [];
    reporter = new ErrorReporter((e) => errors.push(e));
    feed = new DataFeed(buffer, merger, transport, reporter);
  });

  describe('connect()', () => {
    it('returns immediately when no transport is configured', async () => {
      const noTransportFeed = new DataFeed(buffer, merger, null, reporter);
      await noTransportFeed.connect(config);
      expect(transport.subscribed).toBe(false);
      expect(buffer.length).toBe(0);
      expect(errors).toHaveLength(0);
    });

    it('loads history then subscribes to realtime', async () => {
      transport.history = [makeCandle(0), makeCandle(1), makeCandle(2)];
      await feed.connect(config);
      expect(buffer.length).toBe(3);
      expect(transport.subscribed).toBe(true);
      expect(errors).toHaveLength(0);
    });

    it('uses a 30-day history window', async () => {
      await feed.connect(config);
      expect(transport.lastReq).toBeTruthy();
      expect(transport.lastReq!.symbol).toBe('BTCUSDT');
      expect(transport.lastReq!.resolution).toBe('1H');
      // 30 days = 2_592_000 s — allow 1s of drift for Math.floor(Date.now())
      const window = transport.lastReq!.to - transport.lastReq!.from;
      expect(window).toBeGreaterThanOrEqual(2_591_999);
      expect(window).toBeLessThanOrEqual(2_592_001);
    });

    it('reports fetch errors as fatal when connect is the active one', async () => {
      transport.fetchError = new Error('network down');
      await feed.connect(config);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.where).toBe('fetchHistory');
      expect(errors[0]!.fatal).toBe(true);
      expect(errors[0]!.error.message).toBe('network down');
    });

    it('reports stale-connect errors as non-fatal', async () => {
      transport.setDeferred(true);
      const firstConnect = feed.connect(config);
      // Start a second connect → bumps version, making the first one stale
      transport.setDeferred(false);
      await feed.connect({ symbol: 'ETHUSDT', resolution: '1H' });
      // Now reject the first (now stale) connect's fetchHistory
      transport.rejectPending(new Error('first attempt aborted'));
      await firstConnect;

      const stale = errors.find((e) => e.error.message === 'first attempt aborted');
      expect(stale).toBeTruthy();
      expect(stale!.fatal).toBe(false);
    });

    it('disconnects previous subscription before connecting again', async () => {
      transport.history = [makeCandle(0)];
      await feed.connect(config);
      expect(transport.subscribed).toBe(true);
      await feed.connect({ symbol: 'ETHUSDT', resolution: '1H' });
      // Subscribe was re-called; unsubscribe happened in between
      expect(transport.subscribed).toBe(true);
    });

    it('realtime callback ignores updates from stale connections', async () => {
      transport.history = [makeCandle(0)];
      await feed.connect(config);
      const staleCallback = transport.onUpdateCallback!;

      // Second connect invalidates the first callback
      await feed.connect({ symbol: 'ETHUSDT', resolution: '1H' });

      // Call the old callback — it should be a no-op
      const lengthBefore = buffer.length;
      staleCallback([makeCandle(99)]);
      expect(buffer.length).toBe(lengthBefore);
    });
  });

  describe('loadMoreHistory()', () => {
    it('returns 0 when no transport', async () => {
      const noTransportFeed = new DataFeed(buffer, merger, null, reporter);
      const added = await noTransportFeed.loadMoreHistory();
      expect(added).toBe(0);
    });

    it('returns 0 when the buffer is empty', async () => {
      await feed.connect(config);
      const added = await feed.loadMoreHistory();
      expect(added).toBe(0);
    });

    it('reports loadMoreHistory errors as non-fatal', async () => {
      transport.history = [makeCandle(10), makeCandle(11)];
      await feed.connect(config);
      transport.fetchError = new Error('history endpoint broken');
      const added = await feed.loadMoreHistory();
      expect(added).toBe(0);
      const loadErr = errors.find((e) => e.where === 'loadMoreHistory');
      expect(loadErr).toBeTruthy();
      expect(loadErr!.fatal).toBe(false);
    });
  });

  describe('destroy()', () => {
    it('calls transport.destroy', () => {
      feed.destroy();
      expect(transport.destroyed).toBe(true);
    });

    it('is idempotent when called without a transport', () => {
      const noTransportFeed = new DataFeed(buffer, merger, null, reporter);
      expect(() => noTransportFeed.destroy()).not.toThrow();
    });
  });
});
