import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { OHLCVChart } from '../OHLCVChart';
import { installCanvasStub } from '../test-utils/canvasStub';
import type { Candle } from '../types';
import { isFullState, type LayoutState, type FullState } from './ChartState';
import { ValidationError } from '../data/validation';

function makeCandle(i: number): Candle {
  return {
    o: 100 + i,
    h: 105 + i,
    l: 95 + i,
    c: 102 + i,
    v: 10 + i,
    t: 1_700_000_000 + i * 60,
  };
}

function createContainer(): HTMLDivElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({
      width: 1000,
      height: 500,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 500,
      toJSON() {},
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

describe('OHLCVChart save/load state', () => {
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

  describe('saveLayoutState', () => {
    it('captures a fresh chart as version 1 with no indicators or drawings', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      const state = chart.saveLayoutState();
      expect(state.version).toBe(1);
      expect(state.symbol).toBe('BTC/USDT');
      expect(state.resolution).toBe('1H');
      expect(state.chartType).toBe('candles');
      expect(state.indicators).toEqual([]);
      expect(state.drawings).toEqual([]);
      expect(isFullState(state)).toBe(false);
      chart.destroy();
    });

    it('captures viewport pan + chartType + indicators set via configs', () => {
      const chart = new OHLCVChart({ container, symbol: 'ETH/USDT', resolution: '15m' });
      chart.setData(Array.from({ length: 500 }, (_, i) => makeCandle(i)));
      chart.setChartType('line');
      chart.setIndicatorConfigs([
        { type: 'sma', period: 20 },
        { type: 'ema', period: 50 },
      ]);
      chart.getViewport().pan(-100);

      const state = chart.saveLayoutState();
      expect(state.symbol).toBe('ETH/USDT');
      expect(state.resolution).toBe('15m');
      expect(state.chartType).toBe('line');
      expect(state.indicators).toEqual([
        { type: 'sma', period: 20 },
        { type: 'ema', period: 50 },
      ]);
      expect(state.viewport.startIndex).toBeLessThan(500);
      expect(state.viewport.autoFollow).toBe(false);
      chart.destroy();
    });

    it('returns empty indicators when host used legacy setIndicators(Indicator[])', async () => {
      const { SMA } = await import('../indicators/SMA');
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      chart.setData([makeCandle(0)]);
      chart.setIndicators([new SMA(20)]);

      const state = chart.saveLayoutState();
      expect(state.indicators).toEqual([]);
      expect(chart.getIndicators().length).toBe(1);
      chart.destroy();
    });
  });

  describe('saveFullState', () => {
    it('includes the data window', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      const candles = Array.from({ length: 10 }, (_, i) => makeCandle(i));
      chart.setData(candles);

      const state = chart.saveFullState();
      expect(isFullState(state)).toBe(true);
      expect(state.data).toHaveLength(10);
      expect(state.data[0]!.t).toBe(1_700_000_000);
      expect(state.data[9]!.t).toBe(1_700_000_000 + 9 * 60);
      chart.destroy();
    });
  });

  describe('loadState', () => {
    it('round-trips LayoutState across two chart instances', () => {
      const c1 = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      c1.setData(Array.from({ length: 500 }, (_, i) => makeCandle(i)));
      c1.setChartType('area');
      c1.setIndicatorConfigs([{ type: 'rsi', period: 14 }]);
      c1.getViewport().pan(-50);
      const snapshot = c1.saveLayoutState();
      c1.destroy();

      const container2 = createContainer();
      const c2 = new OHLCVChart({ container: container2, symbol: 'OTHER', resolution: '1m' });
      // Pre-load data into c2 since LayoutState does not carry it
      c2.setData(Array.from({ length: 500 }, (_, i) => makeCandle(i)));

      c2.loadState(snapshot);

      const restored = c2.saveLayoutState();
      expect(restored.symbol).toBe('BTC/USDT');
      expect(restored.resolution).toBe('1H');
      expect(restored.chartType).toBe('area');
      expect(restored.indicators).toEqual([{ type: 'rsi', period: 14 }]);
      expect(restored.viewport.startIndex).toBeCloseTo(snapshot.viewport.startIndex, 5);
      expect(restored.viewport.autoFollow).toBe(snapshot.viewport.autoFollow);
      c2.destroy();
      container2.remove();
    });

    it('round-trips FullState without preloading data', () => {
      const c1 = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      c1.setData(Array.from({ length: 20 }, (_, i) => makeCandle(i)));
      const snapshot = c1.saveFullState();
      c1.destroy();

      const container2 = createContainer();
      const c2 = new OHLCVChart({ container: container2, symbol: 'X', resolution: 'Y' });
      c2.loadState(snapshot);

      expect(c2.getBuffer().length).toBe(20);
      expect(c2.saveLayoutState().symbol).toBe('BTC/USDT');
      c2.destroy();
      container2.remove();
    });

    it('throws ValidationError on unsupported version', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC', resolution: '1H' });
      const bogus = { version: 2 } as unknown as LayoutState;
      expect(() => chart.loadState(bogus)).toThrow(ValidationError);
      chart.destroy();
    });

    it('preserves existing buffer when LayoutState has no data', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      const candles = Array.from({ length: 10 }, (_, i) => makeCandle(i));
      chart.setData(candles);
      const layout: LayoutState = chart.saveLayoutState();

      // Swap out buffer with completely different data.
      chart.setData(Array.from({ length: 3 }, (_, i) => makeCandle(i + 100)));
      expect(chart.getBuffer().length).toBe(3);

      // Loading the layout (which has no data) must keep the current 3-candle buffer.
      chart.loadState(layout);
      expect(chart.getBuffer().length).toBe(3);
      chart.destroy();
    });

    it('loadState with indicators creates matching instances', () => {
      const chart = new OHLCVChart({ container, symbol: 'BTC/USDT', resolution: '1H' });
      chart.setData(Array.from({ length: 100 }, (_, i) => makeCandle(i)));

      const state: FullState = {
        version: 1,
        symbol: 'BTC/USDT',
        resolution: '1H',
        chartType: 'candles',
        theme: 'dark',
        viewport: { startIndex: 0, candleWidth: 8, autoFollow: true },
        indicators: [
          { type: 'sma', period: 20 },
          { type: 'bb', period: 20, stdDev: 2 },
        ],
        drawings: [],
        data: Array.from({ length: 100 }, (_, i) => makeCandle(i)),
      };

      chart.loadState(state);
      expect(chart.getIndicators()).toHaveLength(2);
      expect(chart.getIndicatorConfigs()).toEqual([
        { type: 'sma', period: 20 },
        { type: 'bb', period: 20, stdDev: 2 },
      ]);
      chart.destroy();
    });
  });
});
