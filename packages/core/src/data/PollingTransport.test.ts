import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PollingTransport } from './PollingTransport';
import { ErrorReporter } from '../ErrorReporter';
import type { ChartError, DataFeedConfig } from '../types';

const config: DataFeedConfig = { symbol: 'BTCUSDT', resolution: '1H' };

describe('PollingTransport', () => {
  let originalFetch: typeof globalThis.fetch;
  let errors: ChartError[];
  let reporter: ErrorReporter;

  beforeEach(() => {
    vi.useFakeTimers();
    errors = [];
    reporter = new ErrorReporter((e) => errors.push(e));
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('parses the default response shape', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        o: [100, 101],
        h: [105, 106],
        l: [99, 100],
        c: [104, 105],
        v: [10, 20],
        t: [1_700_000_000, 1_700_000_060],
      }),
    } as Response);

    const t = new PollingTransport({ apiUrl: '/api/klines' });
    const candles = await t.fetchHistory({
      symbol: 'BTCUSDT',
      resolution: '1H',
      from: 0,
      to: 1_700_000_060,
    });
    expect(candles).toHaveLength(2);
    expect(candles[0]).toEqual({ o: 100, h: 105, l: 99, c: 104, v: 10, t: 1_700_000_000 });
  });

  it('returns empty array for malformed response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ json: async () => null } as Response);
    const t = new PollingTransport({ apiUrl: '/api/klines' });
    const candles = await t.fetchHistory({ symbol: 'X', resolution: '1H', from: 0, to: 1 });
    expect(candles).toEqual([]);
  });

  it('skips rows where any field is not a number', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        o: [100, 'bad', 102],
        h: [101, 102, 103],
        l: [99, 100, 101],
        c: [100, 101, 102],
        v: [1, 2, 3],
        t: [1, 2, 3],
      }),
    } as Response);

    const t = new PollingTransport({ apiUrl: '/api/klines' });
    const candles = await t.fetchHistory({ symbol: 'X', resolution: '1H', from: 0, to: 1 });
    // row 1 skipped; rows 0 and 2 kept
    expect(candles).toHaveLength(2);
  });

  it('subscribe schedules periodic polling', async () => {
    const updates: number[] = [];
    let pollCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => ({
      json: async () => {
        pollCount++;
        return {
          o: [100 + pollCount],
          h: [110],
          l: [90],
          c: [105],
          v: [1],
          t: [1_700_000_000 + pollCount],
        };
      },
    }) as unknown as Promise<Response>);

    const t = new PollingTransport({ apiUrl: '/api/klines', pollInterval: 1000, reporter });
    t.subscribe(config, (candles) => updates.push(candles[0]!.o));

    // Poll fires via setInterval, with real microtasks between — advance time + flush promises
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(pollCount).toBeGreaterThanOrEqual(2);
    expect(updates.length).toBeGreaterThanOrEqual(2);

    t.unsubscribe();
  });

  it('skips concurrent polls via _pollInFlight guard', async () => {
    let inFlight = 0;
    let maxConcurrent = 0;

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      // Deferred response — test drains it below
      await new Promise((resolve) => setTimeout(resolve, 100));
      inFlight--;
      return {
        json: async () => ({ o: [1], h: [1], l: [1], c: [1], v: [1], t: [1] }),
      } as Response;
    });

    const t = new PollingTransport({ apiUrl: '/api/klines', pollInterval: 10, reporter });
    t.subscribe(config, () => {});

    // Three tick intervals fire before the first poll's fetch resolves
    await vi.advanceTimersByTimeAsync(50);
    expect(maxConcurrent).toBeLessThanOrEqual(1);

    t.unsubscribe();
    await vi.runAllTimersAsync();
  });

  it('unsubscribe clears timer and aborts', () => {
    const t = new PollingTransport({ apiUrl: '/api/klines', reporter });
    t.subscribe(config, () => {});
    t.unsubscribe();
    // After unsubscribe, no more fetches should fire
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    vi.advanceTimersByTime(60_000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports poll errors as non-fatal via reporter', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network timeout'));
    const t = new PollingTransport({ apiUrl: '/api/klines', pollInterval: 10, reporter });
    t.subscribe(config, () => {});

    await vi.advanceTimersByTimeAsync(50);

    const pollErr = errors.find((e) => e.error.message === 'network timeout');
    expect(pollErr).toBeTruthy();
    expect(pollErr!.where).toBe('subscribe');
    expect(pollErr!.fatal).toBe(false);

    t.unsubscribe();
  });

  it('setReporter wires an optional reporter post-construction', async () => {
    const late: ChartError[] = [];
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('late failure'));

    const t = new PollingTransport({ apiUrl: '/api/klines', pollInterval: 10 });
    t.setReporter(new ErrorReporter((e) => late.push(e)));
    t.subscribe(config, () => {});

    await vi.advanceTimersByTimeAsync(50);

    expect(late.some((e) => e.error.message === 'late failure')).toBe(true);
    t.unsubscribe();
  });

  it('destroy delegates to unsubscribe', () => {
    const t = new PollingTransport({ apiUrl: '/api/klines', reporter });
    t.subscribe(config, () => {});
    t.destroy();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    vi.advanceTimersByTime(60_000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
