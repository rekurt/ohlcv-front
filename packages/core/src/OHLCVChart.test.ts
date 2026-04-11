import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { OHLCVChart } from './OHLCVChart';
import { installCanvasStub } from './test-utils/canvasStub';
import type { Candle, ChartError, DataTransport, HistoryRequest } from './types';

function makeCandle(i: number): Candle {
  return { o: 100, h: 101, l: 99, c: 100.5, v: 10, t: 1_700_000_000 + i * 60 };
}

class MockTransport implements DataTransport {
  history: Candle[] = [];
  subscribed = false;
  destroyed = false;
  fetchError: Error | null = null;

  async fetchHistory(_req: HistoryRequest): Promise<Candle[]> {
    if (this.fetchError) throw this.fetchError;
    return this.history;
  }
  subscribe(): void {
    this.subscribed = true;
  }
  unsubscribe(): void {
    this.subscribed = false;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

function createContainer(): HTMLDivElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({ width: 1000, height: 500, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, toJSON() {} }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

describe('OHLCVChart facade', () => {
  beforeAll(() => {
    installCanvasStub();
  });

  let container: HTMLDivElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  describe('construction', () => {
    it('creates a chart without a transport', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      expect(chart.getBuffer().length).toBe(0);
      expect(chart.getViewport()).toBeDefined();
      chart.destroy();
    });

    it('applies dark theme by default', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      // Background was set on the container during construction
      expect(container.style.backgroundColor).toBeTruthy();
      chart.destroy();
    });

    it('applies light theme when requested', () => {
      const chart = new OHLCVChart({
        container,
        symbol: 'BTC/USDT',
        resolution: '1H',
        theme: 'light',
      });
      expect(container.style.backgroundColor).toBeTruthy();
      chart.destroy();
    });
  });

  describe('setData + updateLastCandle', () => {
    it('populates the buffer from setData', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      const candles = Array.from({ length: 10 }, (_, i) => makeCandle(i));
      chart.setData(candles);
      expect(chart.getBuffer().length).toBe(10);
      chart.destroy();
    });

    it('updateLastCandle modifies the last candle in place', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      chart.setData([makeCandle(0)]);
      const updated = { ...makeCandle(0), c: 200 };
      chart.updateLastCandle(updated);
      expect(chart.getBuffer().lastClose()).toBe(200);
      expect(chart.getBuffer().length).toBe(1);
      chart.destroy();
    });

    // Regression: React/Vue wrappers dispatch `setData(data, { preserveView: true })`
    // on every [data] effect. If the user has panned away from the live edge,
    // re-dispatching the same data (hover, indicator toggle, theme swap, etc.)
    // must NOT snap the viewport back to the end.
    it('setData with preserveView keeps startIndex and autoFollow after user pan', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      const candles = Array.from({ length: 500 }, (_, i) => makeCandle(i));
      chart.setData(candles);

      const vp = chart.getViewport();
      vp.pan(-50);
      const panStart = vp.startIndex;
      expect(vp.autoFollow).toBe(false);

      // React/Vue wrapper re-dispatches the same data array
      chart.setData(candles, { preserveView: true });

      expect(vp.startIndex).toBe(panStart);
      expect(vp.autoFollow).toBe(false);
      chart.destroy();
    });

    // Regression: when autoFollow=true (user is at the live edge), preserveView
    // must still scroll to the right edge so that new realtime candles stay
    // visible. Only the user's explicit pan state is preserved, not a stale
    // startIndex.
    it('setData with preserveView still follows the live edge when autoFollow=true', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      const candles = Array.from({ length: 500 }, (_, i) => makeCandle(i));
      chart.setData(candles);

      const vp = chart.getViewport();
      expect(vp.autoFollow).toBe(true);
      const liveStart = vp.startIndex;

      chart.setData(candles, { preserveView: true });

      expect(vp.autoFollow).toBe(true);
      expect(vp.startIndex).toBe(liveStart);
      chart.destroy();
    });
  });

  describe('navigation methods', () => {
    it('goToLive re-enables autoFollow and scrolls to the end', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      chart.setData(Array.from({ length: 500 }, (_, i) => makeCandle(i)));

      chart.getViewport().pan(-50); // goto past
      expect(chart.getViewport().autoFollow).toBe(false);

      chart.goToLive();
      expect(chart.getViewport().autoFollow).toBe(true);
      chart.destroy();
    });

    it('fitVisible resets candleWidth to default', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      chart.setData(Array.from({ length: 500 }, (_, i) => makeCandle(i)));

      chart.getViewport().candleWidth = 25;
      chart.fitVisible();
      expect(chart.getViewport().candleWidth).toBe(8); // DEFAULT_CANDLE_WIDTH
      chart.destroy();
    });

    it('fitAll scrolls to the start and maximizes visible range', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      // Use a buffer small enough to actually fit at MIN_CANDLE_WIDTH=2 within
      // the 920px chart area (~353 candle slots).
      chart.setData(Array.from({ length: 200 }, (_, i) => makeCandle(i)));

      const vp = chart.getViewport();
      chart.fitAll();
      expect(vp.startIndex).toBe(0);
      expect(vp.visibleCount).toBeGreaterThanOrEqual(200);
      // candleWidth should have been shrunk below the default 8 to fit
      expect(vp.candleWidth).toBeLessThan(8);
      chart.destroy();
    });
  });

  describe('setTheme', () => {
    it('accepts dark/light mode strings', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      expect(() => chart.setTheme('light')).not.toThrow();
      expect(() => chart.setTheme('dark')).not.toThrow();
      chart.destroy();
    });
  });

  describe('error dispatch', () => {
    it('invokes onError when a transport rejects fetchHistory', async () => {
      const transport = new MockTransport();
      transport.fetchError = new Error('oops');
      const errors: ChartError[] = [];

      const chart = new OHLCVChart({
        container,
        symbol: 'BTC/USDT',
        resolution: '1H',
        transport,
        onError: (e) => errors.push(e),
      });

      // DataFeed.connect is scheduled synchronously in the constructor,
      // but fetchHistory is async — wait a tick for the rejection to surface.
      await new Promise((r) => setTimeout(r, 0));

      expect(errors.length).toBeGreaterThanOrEqual(1);
      const fetchErr = errors.find((e) => e.error.message === 'oops');
      expect(fetchErr).toBeTruthy();
      expect(fetchErr!.where).toBe('fetchHistory');
      expect(fetchErr!.fatal).toBe(true);

      chart.destroy();
    });

    it('falls back to console.warn when onError is not provided', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const transport = new MockTransport();
      transport.fetchError = new Error('fallback test');

      const chart = new OHLCVChart({
        container,
        symbol: 'BTC/USDT',
        resolution: '1H',
        transport,
      });

      await new Promise((r) => setTimeout(r, 0));
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
      chart.destroy();
    });
  });

  describe('destroy()', () => {
    it('removes all canvases from the container', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      expect(container.querySelectorAll('canvas').length).toBe(3);
      chart.destroy();
      expect(container.querySelectorAll('canvas').length).toBe(0);
    });

    it('is safe to call multiple times', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      chart.destroy();
      expect(() => chart.destroy()).not.toThrow();
    });

    it('destroys the transport when provided', () => {
      const transport = new MockTransport();
      const chart = new OHLCVChart({
        container,
        symbol: 'BTC/USDT',
        resolution: '1H',
        transport,
      });
      chart.destroy();
      expect(transport.destroyed).toBe(true);
    });
  });
});
