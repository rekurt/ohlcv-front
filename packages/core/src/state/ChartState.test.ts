import { describe, it, expect } from 'vitest';
import { isFullState, type LayoutState, type FullState } from './ChartState';

const baseLayout: LayoutState = {
  version: 1,
  symbol: 'BTC/USDT',
  resolution: '1H',
  chartType: 'candles',
  theme: 'dark',
  viewport: { startIndex: 0, candleWidth: 8, autoFollow: true },
  indicators: [],
  drawings: [],
};

describe('ChartState type guard', () => {
  it('isFullState returns true when data is an array', () => {
    const full: FullState = {
      ...baseLayout,
      data: [{ o: 1, h: 2, l: 0, c: 1.5, v: 10, t: 100 }],
    };
    expect(isFullState(full)).toBe(true);
  });

  it('isFullState returns false for LayoutState without data', () => {
    expect(isFullState(baseLayout)).toBe(false);
  });

  it('isFullState returns true even for empty data array', () => {
    const full: FullState = { ...baseLayout, data: [] };
    expect(isFullState(full)).toBe(true);
  });
});
