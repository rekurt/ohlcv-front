import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { OHLCVChart } from './OHLCVChart';
import { ChartEngine } from './rendering/ChartEngine';
import { installCanvasStub } from './test-utils/canvasStub';
import { TrendLine } from './drawings/TrendLine';
import { DrawingLayer } from './drawings/DrawingLayer';
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

/** Resolve after one animation frame (merger coalesces onUpdate via RAF). */
const nextFrame = (): Promise<void> =>
  new Promise<void>((r) => requestAnimationFrame(() => r()));

/** A candle whose close is exactly `c` at sequential time `i` (distinct OHLC). */
function candleAt(i: number, c: number): Candle {
  return { o: c, h: c + 1, l: c - 1, c, v: 10, t: 1_700_000_000 + i * 60 };
}

/**
 * Reach the engine the facade owns, for the few cross-feature assertions that
 * must observe real render state (replay cap, viewport position) rather than a
 * private mirror — never to FORCE a field, only to READ it.
 */
function engineOf(chart: OHLCVChart): ChartEngine {
  return (chart as unknown as { _engine: ChartEngine })._engine;
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

  describe('setLocale (C6)', () => {
    it('no-arg call resets prior custom messages to the baseline', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      const t = (k: string) =>
        (chart as unknown as { _engine: { i18n: { t(key: string): string } } })._engine.i18n.t(k);
      const baseline = t('a11yChartLabel');
      chart.setLocale('de-DE', { a11yChartLabel: 'CUSTOM-LABEL' });
      expect(t('a11yChartLabel')).toBe('CUSTOM-LABEL');
      chart.setLocale(); // reset → baseline, NOT the stale custom override
      expect(t('a11yChartLabel')).toBe(baseline);
      expect(baseline).not.toBe('CUSTOM-LABEL');
      chart.destroy();
    });
  });

  // E2E for the alert-baseline reset on a data swap (Г2a / C3). Replaces a
  // prior tautology that hand-set `_lastAlertClose` and read it back. Here the
  // baseline is seeded the only way production seeds it (a real RAF after data
  // arrives) and observed only through `onAlert` — so reverting the
  // `_lastAlertClose = null` line in setData/switchSymbol fires a stale cross
  // and breaks the test.
  describe('alerts (C3) — baseline reset on data swap (e2e)', () => {
    it('setData drops the baseline so the OLD dataset close cannot fire on the next tick', async () => {
      const onAlert = vi.fn();
      const chart = new OHLCVChart({
        container, symbol: 'BTC/USDT', resolution: '1H', onAlert,
      });
      // Old dataset closes at 100; one RAF seeds the live baseline = 100.
      chart.setData([candleAt(0, 100)]);
      await nextFrame();

      chart.addAlert({ price: 150, condition: 'above' });

      // Full swap to a dataset already above the level (close 200). Without the
      // baseline reset, the stale prev=100 + this dataset's first realtime
      // close (210) would look like an upward 100→210 break through 150.
      chart.setData([candleAt(0, 200)]);
      chart.updateLastCandle(candleAt(0, 210)); // realtime tick on the new bar
      await nextFrame();

      expect(onAlert).not.toHaveBeenCalled();
      chart.destroy();
    });

    it('switchSymbol drops the baseline so the previous symbol close cannot fire', async () => {
      const onAlert = vi.fn();
      const chart = new OHLCVChart({
        container, symbol: 'BTC/USDT', resolution: '1H', onAlert,
      });
      chart.setData([candleAt(0, 100)]);
      await nextFrame(); // live baseline = 100

      chart.addAlert({ price: 150, condition: 'above' });

      // New symbol clears the buffer (connect → clear) and must reset the
      // baseline synchronously. No setData here, so only the switchSymbol reset
      // can prevent a stale 100→210 cross.
      await chart.switchSymbol('ETH/USDT', '1H');
      chart.updateLastCandle(candleAt(0, 210)); // first ETH realtime bar
      await nextFrame();

      expect(onAlert).not.toHaveBeenCalled();
      chart.destroy();
    });
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

  describe('maxCandles eviction', () => {
    it('caps the buffer and keeps the latest candles', () => {
      const chart = new OHLCVChart({
        container,
        symbol: 'BTC/USDT',
        resolution: '1H',
        maxCandles: 100,
      });
      const data = Array.from({ length: 250 }, (_, i) => makeCandle(i));
      chart.setData(data);
      expect(chart.getBuffer().length).toBe(100);
      // Newest candle is retained.
      expect(chart.getBuffer().lastTime()).toBe(makeCandle(249).t);
      chart.destroy();
    });

    it('shifts drawing anchors so they stay pinned after eviction', () => {
      const chart = new OHLCVChart({
        container,
        symbol: 'BTC/USDT',
        resolution: '1H',
        maxCandles: 100,
      });
      chart.setData(Array.from({ length: 100 }, (_, i) => makeCandle(i)));
      const line = new TrendLine('t1');
      line.addPoint({ index: 90, price: 100 });
      line.addPoint({ index: 95, price: 101 });
      chart.getDrawingLayer().add(line);
      // Load 150 candles → evict 50 → every anchor index shifts by -50.
      chart.setData(Array.from({ length: 150 }, (_, i) => makeCandle(i)));
      const snap = chart.getDrawings().find((d) => d.id === 't1');
      expect(snap?.points[0]?.index).toBe(40);
      expect(snap?.points[1]?.index).toBe(45);
      chart.destroy();
    });

    it('does not evict when uncapped', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      chart.setData(Array.from({ length: 500 }, (_, i) => makeCandle(i)));
      expect(chart.getBuffer().length).toBe(500);
      chart.destroy();
    });

    it('evicts on realtime appends but keeps the latest candle', async () => {
      const chart = new OHLCVChart({
        container, symbol: 'BTC/USDT', resolution: '1H', maxCandles: 100,
      });
      chart.setData(Array.from({ length: 100 }, (_, i) => makeCandle(i)));
      chart.updateLastCandle(makeCandle(100)); // new candle past the last
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      expect(chart.getBuffer().length).toBe(100);
      expect(chart.getBuffer().lastTime()).toBe(makeCandle(100).t);
      chart.destroy();
    });

    it('does NOT evict prepended history (load-more must extend the left edge)', async () => {
      const chart = new OHLCVChart({
        container, symbol: 'BTC/USDT', resolution: '1H', maxCandles: 100,
      });
      chart.setData(Array.from({ length: 100 }, (_, i) => makeCandle(i)));
      // Prepend 10 candles strictly older than the current first.
      const older = Array.from({ length: 10 }, (_, i) => makeCandle(i - 10));
      chart.prependHistory(older);
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      expect(chart.getBuffer().length).toBe(110);
      expect(chart.getBuffer().firstTime()).toBe(makeCandle(-10).t);
      chart.destroy();
    });

    it('shifts a custom (host-attached) drawing layer on eviction', () => {
      const chart = new OHLCVChart({
        container, symbol: 'BTC/USDT', resolution: '1H', maxCandles: 100,
      });
      chart.setData(Array.from({ length: 100 }, (_, i) => makeCandle(i)));
      const custom = new DrawingLayer();
      const line = new TrendLine('c1');
      line.addPoint({ index: 90, price: 100 });
      line.addPoint({ index: 95, price: 101 });
      custom.add(line);
      chart.setDrawingLayer(custom);
      // Evict 50 via a larger setData → custom layer anchors shift by -50.
      chart.setData(Array.from({ length: 150 }, (_, i) => makeCandle(i)));
      expect(custom.drawings[0]!.points.map((p) => p.index)).toEqual([40, 45]);
      chart.destroy();
    });
  });

  describe('markers', () => {
    it('sets, appends, removes, and clears markers', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      chart.setData(Array.from({ length: 10 }, (_, i) => makeCandle(i)));
      const t = makeCandle(3).t;

      chart.setMarkers([{ id: 'a', time: t, shape: 'arrowUp', position: 'below' }]);
      expect(chart.getMarkers().map((m) => m.id)).toEqual(['a']);

      chart.addMarker({ id: 'b', time: makeCandle(5).t, shape: 'circle' });
      expect(chart.getMarkers()).toHaveLength(2);

      expect(chart.removeMarker('a')).toBe(true);
      expect(chart.removeMarker('missing')).toBe(false);
      expect(chart.getMarkers().map((m) => m.id)).toEqual(['b']);

      chart.clearMarkers();
      expect(chart.getMarkers()).toHaveLength(0);
      chart.destroy();
    });

    it('renders without throwing when markers are present', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      chart.setData(Array.from({ length: 10 }, (_, i) => makeCandle(i)));
      chart.setMarkers([{ id: 'a', time: makeCandle(4).t, shape: 'flag', text: 'news' }]);
      expect(() => chart.render()).not.toThrow();
      chart.destroy();
    });
  });

  describe('replay mode (C1)', () => {
    it('is not replaying by default', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      chart.setData(Array.from({ length: 20 }, (_, i) => makeCandle(i)));
      expect(chart.isReplaying()).toBe(false);
      chart.destroy();
    });

    it('startReplay engages replay and stepReplay advances; onReplayChange fires', () => {
      const onReplayChange = vi.fn();
      const chart = new OHLCVChart({
        container,
        symbol: 'BTC/USDT',
        resolution: '1H',
        onReplayChange,
      });
      chart.setData(Array.from({ length: 20 }, (_, i) => makeCandle(i)));
      chart.startReplay(0);
      expect(chart.isReplaying()).toBe(true);
      expect(onReplayChange).toHaveBeenLastCalledWith(0, false);
      chart.stepReplay();
      expect(onReplayChange).toHaveBeenLastCalledWith(1, false);
      chart.seekReplay(5);
      expect(onReplayChange).toHaveBeenLastCalledWith(5, false);
      chart.stopReplay();
      expect(chart.isReplaying()).toBe(false);
      chart.destroy();
    });

    it('playReplay advances under fake timers and pauseReplay stops it', () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const onReplayChange = vi.fn();
      const chart = new OHLCVChart({
        container,
        symbol: 'BTC/USDT',
        resolution: '1H',
        onReplayChange,
      });
      chart.setData(Array.from({ length: 20 }, (_, i) => makeCandle(i)));
      chart.startReplay(0);
      chart.setReplaySpeed(10); // 100ms/bar
      chart.playReplay();
      vi.advanceTimersByTime(300); // 3 ticks
      // Last call reflects index 3 (latest reveal).
      const lastCall = (calls: unknown[][]): unknown[] => calls[calls.length - 1]!;
      expect(lastCall(onReplayChange.mock.calls)[0]).toBe(3);
      chart.pauseReplay();
      const last = lastCall(onReplayChange.mock.calls)[0];
      vi.advanceTimersByTime(1000);
      expect(lastCall(onReplayChange.mock.calls)[0]).toBe(last); // no further advance
      chart.destroy();
      vi.useRealTimers();
    });

    it('destroy halts a running replay timer (no late ticks)', () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const onReplayChange = vi.fn();
      const chart = new OHLCVChart({
        container,
        symbol: 'BTC/USDT',
        resolution: '1H',
        onReplayChange,
      });
      chart.setData(Array.from({ length: 20 }, (_, i) => makeCandle(i)));
      chart.startReplay(0);
      chart.setReplaySpeed(10);
      chart.playReplay();
      vi.advanceTimersByTime(100);
      const callsBefore = onReplayChange.mock.calls.length;
      chart.destroy();
      vi.advanceTimersByTime(1000);
      expect(onReplayChange.mock.calls.length).toBe(callsBefore);
      vi.useRealTimers();
    });
  });

  describe('alerts (C3)', () => {
    it('addAlert returns the alert, defaults condition, and attaches a dashed line', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      const alert = chart.addAlert({ price: 150 });
      expect(alert.id).toBe('a_0');
      expect(alert.condition).toBe('crossing');
      expect(alert.active).toBe(true);
      // A price line primitive with id alert:<id> is attached.
      expect(chart.getPrimitives().some((p) => p.id === 'alert:a_0')).toBe(true);
      chart.destroy();
    });

    it('getAlerts / removeAlert / clearAlerts manage the collection and lines', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      const a = chart.addAlert({ price: 150 });
      const b = chart.addAlert({ price: 160 });
      expect(chart.getAlerts().map((x) => x.id)).toEqual([a.id, b.id]);

      expect(chart.removeAlert(a.id)).toBe(true);
      expect(chart.removeAlert(a.id)).toBe(false);
      expect(chart.getPrimitives().some((p) => p.id === 'alert:' + a.id)).toBe(false);
      expect(chart.getAlerts().map((x) => x.id)).toEqual([b.id]);

      chart.clearAlerts();
      expect(chart.getAlerts()).toHaveLength(0);
      expect(chart.getPrimitives().some((p) => p.id.startsWith('alert:'))).toBe(false);
      chart.destroy();
    });

    it('fires onAlert with the triggering alert on a realtime close-price cross', async () => {
      const fired: Array<{ id: string; price: number }> = [];
      const chart = new OHLCVChart({
        container,
        symbol: 'BTC/USDT',
        resolution: '1H',
        onAlert: (a) => fired.push({ id: a.id, price: a.price }),
      });
      // Seed data so the alert baseline (prev close) is below the level.
      chart.setData([candleAt(0, 100)]);
      await nextFrame(); // establishes prev close = 100, no fire (first frame)

      const alert = chart.addAlert({ price: 105, condition: 'crossing' });

      // New candle whose close (110) crosses 105 upward.
      chart.updateLastCandle(candleAt(1, 110));
      await nextFrame();

      expect(fired).toEqual([{ id: alert.id, price: 105 }]);
      // One-shot: the alert is now inactive and its line removed.
      expect(chart.getAlerts()[0]!.active).toBe(false);
      expect(chart.getPrimitives().some((p) => p.id === 'alert:' + alert.id)).toBe(false);
      chart.destroy();
    });

    it('does not fire on the first tick (no previous close yet)', async () => {
      const onAlert = vi.fn();
      const chart = new OHLCVChart({
        container, symbol: 'BTC/USDT', resolution: '1H', onAlert,
      });
      // Alert added before ANY data; the first frame only sets the baseline.
      chart.addAlert({ price: 105, condition: 'crossing' });
      chart.setData([candleAt(0, 110)]); // close already past the level
      await nextFrame();
      // No prev close existed on this first frame → must not fire.
      expect(onAlert).not.toHaveBeenCalled();
      chart.destroy();
    });

    it('does not re-fire a one-shot alert on subsequent ticks', async () => {
      const onAlert = vi.fn();
      const chart = new OHLCVChart({
        container, symbol: 'BTC/USDT', resolution: '1H', onAlert,
      });
      chart.setData([candleAt(0, 100)]);
      await nextFrame();
      chart.addAlert({ price: 105, condition: 'above' });

      chart.updateLastCandle(candleAt(1, 110)); // upward break → fires
      await nextFrame();
      chart.updateLastCandle(candleAt(2, 120)); // still above → must NOT re-fire
      await nextFrame();
      expect(onAlert).toHaveBeenCalledTimes(1);
      chart.destroy();
    });

    it('saveLayoutState includes alerts; loadState restores them and redraws lines', () => {
      const c1 = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      c1.addAlert({ price: 150, condition: 'above', message: 'TP' });
      c1.addAlert({ id: 'a_keep', price: 90, condition: 'below' });
      const snapshot = c1.saveLayoutState();
      expect(snapshot.alerts).toEqual([
        { id: 'a_0', price: 150, condition: 'above', active: true, message: 'TP' },
        { id: 'a_keep', price: 90, condition: 'below', active: true },
      ]);
      c1.destroy();

      const container2 = createContainer();
      const c2 = new OHLCVChart({ container: container2, symbol: 'X', resolution: '1m' });
      c2.loadState(snapshot);
      expect(c2.getAlerts()).toEqual([
        { id: 'a_0', price: 150, condition: 'above', active: true, message: 'TP' },
        { id: 'a_keep', price: 90, condition: 'below', active: true },
      ]);
      // Lines redrawn for active alerts.
      expect(c2.getPrimitives().some((p) => p.id === 'alert:a_0')).toBe(true);
      expect(c2.getPrimitives().some((p) => p.id === 'alert:a_keep')).toBe(true);
      c2.destroy();
      container2.remove();
    });

    it('restores a fired (inactive) alert disarmed and without a line', () => {
      const c1 = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      c1.addAlert({ price: 150, condition: 'crossing' });
      // Simulate a prior fire by reaching into the manager via save/edit.
      const snapshot = c1.saveLayoutState();
      snapshot.alerts![0]!.active = false;
      c1.destroy();

      const container2 = createContainer();
      const c2 = new OHLCVChart({ container: container2, symbol: 'X', resolution: '1m' });
      c2.loadState(snapshot);
      expect(c2.getAlerts()[0]!.active).toBe(false);
      expect(c2.getPrimitives().some((p) => p.id === 'alert:a_0')).toBe(false);
      c2.destroy();
      container2.remove();
    });

    it('loadState with a pre-C3 state (no alerts field) clears alerts without throwing', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      chart.addAlert({ price: 150 });
      // Build a legacy layout snapshot lacking the alerts field.
      const legacy = chart.saveLayoutState();
      delete legacy.alerts;
      expect(() => chart.loadState(legacy)).not.toThrow();
      expect(chart.getAlerts()).toHaveLength(0);
      chart.destroy();
    });

    // Г3d: while replaying, the user is looking at the past — a realtime tick
    // moving the LIVE close through an alert level must not consume the one-shot
    // alert. Once replay stops, evaluation resumes and the (still-armed) alert
    // fires on the next genuine cross.
    it('alerts are frozen during replay and resume after stopReplay', async () => {
      const onAlert = vi.fn();
      const chart = new OHLCVChart({
        container, symbol: 'BTC/USDT', resolution: '1H', onAlert,
      });
      chart.setData([candleAt(0, 100)]);
      await nextFrame(); // baseline = 100 (below the level)
      chart.addAlert({ price: 150, condition: 'above' });

      chart.startReplay(0); // cap engaged — viewing the past
      expect(chart.isReplaying()).toBe(true);

      // The live close jumps 100 → 210, crossing 150. Frozen: must NOT fire,
      // but the baseline keeps tracking the live close so post-replay is clean.
      chart.updateLastCandle(candleAt(0, 210));
      await nextFrame();
      expect(onAlert).not.toHaveBeenCalled();
      expect(chart.getAlerts()[0]!.active).toBe(true); // still armed (not consumed)

      chart.stopReplay();
      // Drop below the level first (no upward break), then cross it upward.
      chart.updateLastCandle(candleAt(1, 100));
      await nextFrame();
      expect(onAlert).not.toHaveBeenCalled();
      chart.updateLastCandle(candleAt(2, 210)); // 100 → 210 upward break of 150
      await nextFrame();
      expect(onAlert).toHaveBeenCalledTimes(1);
      chart.destroy();
    });
  });

  // Replay lifecycle cross-feature regressions (Г2). A live data feed and the
  // replay controller share one viewport + buffer; these guard the seams where
  // a realtime tick must NOT disturb replay state and vice-versa.
  describe('replay lifecycle (Г2)', () => {
    it('setData ends an active replay and clears the engine cap (Г2a)', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      chart.setData(Array.from({ length: 50 }, (_, i) => makeCandle(i)));
      chart.startReplay(5);
      expect(chart.isReplaying()).toBe(true);
      expect(engineOf(chart).getReplayCap()).not.toBeNull();

      // A full data swap referred to the OLD buffer length — the stale cap would
      // hide the new bars and freeze play(). setData must stop replay.
      chart.setData(Array.from({ length: 60 }, (_, i) => makeCandle(i)));
      expect(chart.isReplaying()).toBe(false);
      expect(engineOf(chart).getReplayCap()).toBeNull();
      chart.destroy();
    });

    it('switchSymbol ends an active replay and clears the engine cap (Г2a)', async () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      chart.setData(Array.from({ length: 50 }, (_, i) => makeCandle(i)));
      chart.startReplay(5);
      expect(chart.isReplaying()).toBe(true);

      await chart.switchSymbol('ETH/USDT', '1H');
      expect(chart.isReplaying()).toBe(false);
      expect(engineOf(chart).getReplayCap()).toBeNull();
      chart.destroy();
    });

    it('a realtime tick does not yank the viewport to the live edge during replay (Г2b)', async () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      chart.setData(Array.from({ length: 500 }, (_, i) => makeCandle(i)));
      const vp = chart.getViewport();
      // Zoom in so the buffer is much larger than the visible window — only then
      // is "scroll to live edge" a visible jump the merger could wrongly do.
      vp.candleWidth = 20;
      vp.setLayout(vp.layout);
      expect(vp.visibleCount).toBeLessThan(chart.getBuffer().length);

      chart.startReplay(30); // controller parks the viewport on bar 30
      const parkedStart = vp.startIndex;

      // A realtime append/update must repaint but leave the replay viewport put;
      // the merger's autoFollow scroll is gated on getReplayCap() === null.
      chart.updateLastCandle(makeCandle(500));
      await nextFrame();
      expect(vp.startIndex).toBe(parkedStart);
      chart.destroy();
    });

    it('eviction is frozen during replay so the cap keeps pointing at the same bar (Г2c)', async () => {
      const chart = new OHLCVChart({
        container, symbol: 'BTC/USDT', resolution: '1H', maxCandles: 100,
      });
      chart.setData(Array.from({ length: 100 }, (_, i) => makeCandle(i)));
      chart.startReplay(40);
      const capBefore = engineOf(chart).getReplayCap();
      const lenBefore = chart.getBuffer().length;

      // Push several realtime bars PAST maxCandles. Eviction from the head would
      // shift every logical index and silently move which bar the cap reveals,
      // so it must be skipped while a cap is active.
      for (let i = 0; i < 10; i++) {
        chart.updateLastCandle(makeCandle(100 + i));
        await nextFrame();
      }
      expect(chart.getBuffer().length).toBe(lenBefore + 10); // not truncated to 100
      expect(engineOf(chart).getReplayCap()).toBe(capBefore); // cap bar unchanged
      chart.destroy();
    });
  });

  // Future-bar leak regressions (Г3). With a replay cap active the buffer
  // physically holds bars past the cap; every index a pointer/range resolves
  // must be clamped to maxVisibleIndex so a not-yet-revealed bar never leaks.
  describe('future-bar leak under replay (Г3)', () => {
    /** Dispatch a real click at chart-area pixel (x, y) on the interactive canvas. */
    function clickAt(chart: OHLCVChart, x: number, y: number): void {
      const canvas = engineOf(chart).topCanvas;
      // jsdom returns an all-zero canvas rect, so clientX/clientY == chart x/y.
      canvas.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
    }

    it('onCandleClick is clamped to the cap — a click in the future zone resolves to a revealed bar (Г3a)', () => {
      const clicked: number[] = [];
      const chart = new OHLCVChart({
        container, symbol: 'BTC/USDT', resolution: '1H',
        onCandleClick: (_c, index) => clicked.push(index),
      });
      // Buffer 200, reveal only 20 (cap). With visibleCount (~88) > cap the
      // revealed bar 19 sits near the left and the right of the chart area is
      // the empty future zone backed by real bars 20..199.
      chart.setData(Array.from({ length: 200 }, (_, i) => makeCandle(i)));
      chart.startReplay(19); // cap = 20, maxVisibleIndex = 19
      const maxIdx = engineOf(chart).maxVisibleIndex();
      expect(maxIdx).toBe(19);

      // Click near the right edge of the chart area (well past the revealed bar
      // 19). xToIndex resolves to a future bar (~86); the clamp must pull it to
      // <= 19 instead of reporting candle 86 to the host.
      clickAt(chart, 900, 400);
      expect(clicked.length).toBe(1);
      expect(clicked[0]!).toBeLessThanOrEqual(maxIdx);
      chart.destroy();
    });

    it('onVisibleRangeChange never reports a timestamp past the cap (Г3b)', () => {
      const ranges: Array<[number, number]> = [];
      const chart = new OHLCVChart({
        container, symbol: 'BTC/USDT', resolution: '1H',
        onVisibleRangeChange: (from, to) => ranges.push([from, to]),
      });
      chart.setData(Array.from({ length: 200 }, (_, i) => makeCandle(i)));
      chart.startReplay(19); // cap = 20, maxVisibleIndex = 19

      // Drive a real viewport change so the range callback fires (it only runs
      // from PanZoomController, not a direct vp.pan). The visible window
      // nominally reaches ~bar 88, far past the cap; the end index must clamp.
      const canvas = engineOf(chart).topCanvas;
      canvas.dispatchEvent(
        new WheelEvent('wheel', { deltaX: 30, deltaY: 0, clientX: 400, clientY: 250, bubbles: true }),
      );

      const cappedTime = makeCandle(19).t; // newest revealed bar's time
      expect(ranges.length).toBeGreaterThan(0);
      for (const [, to] of ranges) {
        // The reported end must not be a bar beyond the revealed prefix.
        expect(to).toBeLessThanOrEqual(cappedTime);
      }
      chart.destroy();
    });
  });

  // Г5: a host-supplied onDblClick owns the double-click in the chart area, so
  // the built-in fit-visible reset must NOT also fire and yank zoom/scroll.
  describe('double-click reset vs host onDblClick (Г5)', () => {
    function dblClickAt(chart: OHLCVChart, x: number, y: number): void {
      const canvas = engineOf(chart).topCanvas;
      canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: x, clientY: y, bubbles: true }));
    }

    it('suppresses the built-in fitVisible when onDblClick is configured', () => {
      const chart = new OHLCVChart({
        container, symbol: 'BTC/USDT', resolution: '1H', onDblClick: () => {},
      });
      chart.setData(Array.from({ length: 500 }, (_, i) => makeCandle(i)));
      const vp = chart.getViewport();
      // Deep-zoom + pan away from the live edge so fitVisible WOULD be a visible
      // change (it resets candleWidth to 8 and scrolls to the end).
      vp.candleWidth = 25;
      vp.setLayout(vp.layout);
      vp.pan(-80);
      const widthBefore = vp.candleWidth;
      const startBefore = vp.startIndex;

      dblClickAt(chart, 400, 250); // inside the chart area
      expect(vp.candleWidth).toBe(widthBefore); // fitVisible did NOT run
      expect(vp.startIndex).toBe(startBefore);
      chart.destroy();
    });

    it('still runs the built-in fitVisible when no onDblClick is configured', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      chart.setData(Array.from({ length: 500 }, (_, i) => makeCandle(i)));
      const vp = chart.getViewport();
      vp.candleWidth = 25;
      vp.setLayout(vp.layout);
      vp.pan(-80);

      dblClickAt(chart, 400, 250);
      expect(vp.candleWidth).toBe(8); // DEFAULT_CANDLE_WIDTH — fitVisible ran
      chart.destroy();
    });
  });

  // Г6: loadState is a trust boundary (share URL / localStorage / server JSON).
  // A forged viewport must be sanitized, not produce NaN/Infinity render
  // geometry or an injected scale mode.
  describe('loadState hardening (Г6)', () => {
    function baseState(chart: OHLCVChart) {
      return chart.saveLayoutState();
    }

    it('clamps a forged candleWidth:0 so visibleCount stays finite (Г6a)', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      chart.setData(Array.from({ length: 100 }, (_, i) => makeCandle(i)));
      const forged = baseState(chart);
      forged.viewport.candleWidth = 0; // candleStep 0 → Infinity visibleCount

      chart.loadState(forged);
      const vp = chart.getViewport();
      expect(vp.candleWidth).toBeGreaterThan(0);
      expect(Number.isFinite(vp.visibleCount)).toBe(true);
      chart.destroy();
    });

    it('rejects a forged viewport.startIndex:NaN with a ValidationError (Г6a)', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      chart.setData(Array.from({ length: 100 }, (_, i) => makeCandle(i)));
      const forged = baseState(chart);
      forged.viewport.startIndex = Number.NaN;

      // Number.isFinite guard in loadState must reject this rather than write a
      // NaN startIndex that poisons every downstream pixel mapping.
      expect(() => chart.loadState(forged)).toThrow();
      chart.destroy();
    });

    it('whitelists priceScaleMode so a forged enum falls back to linear (Г6b)', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      chart.setData(Array.from({ length: 100 }, (_, i) => makeCandle(i)));
      const forged = baseState(chart) as unknown as {
        viewport: { priceScaleMode: string };
      };
      forged.viewport.priceScaleMode = 'evil';

      chart.loadState(forged as never);
      expect(chart.getPriceScaleMode()).toBe('linear');
      chart.destroy();
    });
  });
});
