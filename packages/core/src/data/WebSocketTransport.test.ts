import { describe, it, expect, beforeEach } from 'vitest';
import { WebSocketTransport } from './WebSocketTransport';
import type { Candle, DataFeedConfig, HistoryRequest } from '../types';

/**
 * Concrete subclass used only for testing the abstract base class.
 * Captures calls to the abstract methods so we can assert on them.
 */
class TestWebSocketTransport extends WebSocketTransport {
  connectedUrl: string | null = null;
  subscriptions: Array<{ channel: string; handler: (data: unknown) => void }> = [];
  history: Candle[] = [];
  lastHistoryReq: HistoryRequest | null = null;

  override connect(url: string): void {
    this.connectedUrl = url;
  }

  override subscribeChannel(channel: string, handler: (data: unknown) => void): void {
    this.subscriptions.push({ channel, handler });
  }

  override unsubscribeChannel(channel: string): void {
    this.subscriptions = this.subscriptions.filter((s) => s.channel !== channel);
  }

  override async fetchHistory(req: HistoryRequest): Promise<Candle[]> {
    this.lastHistoryReq = req;
    return this.history;
  }

  /** Simulate an incoming push from the server. */
  pushToSubscribers(data: unknown): void {
    for (const { handler } of this.subscriptions) handler(data);
  }

  /** Expose the protected default parser for direct testing. */
  parseExternal(data: unknown): Candle[] {
    return this.parseCandles(data);
  }
}

const config: DataFeedConfig = { symbol: 'BTCUSDT', resolution: '1H' };
const candle: Candle = { o: 100, h: 110, l: 90, c: 105, v: 1000, t: 1_700_000_000 };

describe('WebSocketTransport (abstract base)', () => {
  let t: TestWebSocketTransport;

  beforeEach(() => {
    t = new TestWebSocketTransport();
  });

  describe('subscribe()', () => {
    it('opens a channel named "{symbol}:{resolution}"', () => {
      t.subscribe(config, () => {});
      expect(t.subscriptions).toHaveLength(1);
      expect(t.subscriptions[0]!.channel).toBe('BTCUSDT:1H');
    });

    it('invokes onUpdate with parsed candles when the channel pushes an array', () => {
      const received: Candle[][] = [];
      t.subscribe(config, (candles) => received.push(candles));
      t.pushToSubscribers([candle]);
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual([candle]);
    });

    it('accepts a single-candle push (non-array with "t" field)', () => {
      const received: Candle[][] = [];
      t.subscribe(config, (candles) => received.push(candles));
      t.pushToSubscribers(candle);
      expect(received).toHaveLength(1);
      expect(received[0]!).toHaveLength(1);
    });

    it('drops pushes that parseCandles classifies as empty', () => {
      const received: Candle[][] = [];
      t.subscribe(config, (candles) => received.push(candles));
      t.pushToSubscribers(null);
      t.pushToSubscribers({ noTField: true });
      expect(received).toHaveLength(0);
    });
  });

  describe('unsubscribe()', () => {
    it('removes the channel handler', () => {
      t.subscribe(config, () => {});
      expect(t.subscriptions).toHaveLength(1);
      t.unsubscribe();
      expect(t.subscriptions).toHaveLength(0);
    });

    it('is safe to call twice', () => {
      t.subscribe(config, () => {});
      t.unsubscribe();
      expect(() => t.unsubscribe()).not.toThrow();
    });

    it('is a no-op when nothing was subscribed', () => {
      expect(() => t.unsubscribe()).not.toThrow();
    });
  });

  describe('parseCandles (default implementation)', () => {
    it('passes arrays through unchanged', () => {
      expect(t.parseExternal([candle])).toEqual([candle]);
    });

    it('wraps a single object-with-t in an array', () => {
      expect(t.parseExternal(candle)).toEqual([candle]);
    });

    it('returns [] for null', () => {
      expect(t.parseExternal(null)).toEqual([]);
    });

    it('returns [] for objects without t field', () => {
      expect(t.parseExternal({ o: 1, h: 2, l: 0, c: 1, v: 1 })).toEqual([]);
    });

    it('returns [] for primitives', () => {
      expect(t.parseExternal('candle')).toEqual([]);
      expect(t.parseExternal(42)).toEqual([]);
    });
  });

  describe('destroy()', () => {
    it('delegates to unsubscribe', () => {
      t.subscribe(config, () => {});
      t.destroy();
      expect(t.subscriptions).toHaveLength(0);
    });
  });
});
