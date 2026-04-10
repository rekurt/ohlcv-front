import { describe, it, expect, afterEach } from 'vitest';
import {
  lowerBound,
  upperBound,
  niceStep,
  niceGridValues,
  formatPrice,
  formatVolume,
  formatTime,
  computeLayout,
  clamp,
  resolveTheme,
} from './utils';
import { DARK_THEME, LIGHT_THEME } from './constants';

describe('lowerBound', () => {
  it('finds first index >= target', () => {
    const arr = new Float64Array([10, 20, 30, 40, 50]);
    expect(lowerBound(arr, 25)).toBe(2);
    expect(lowerBound(arr, 30)).toBe(2);
    expect(lowerBound(arr, 10)).toBe(0);
  });

  it('returns length when target > all', () => {
    const arr = new Float64Array([10, 20, 30]);
    expect(lowerBound(arr, 100)).toBe(3);
  });

  it('returns 0 for empty array', () => {
    const arr = new Float64Array([]);
    expect(lowerBound(arr, 5)).toBe(0);
  });
});

describe('upperBound', () => {
  it('finds first index > target', () => {
    const arr = new Float64Array([10, 20, 30, 40, 50]);
    expect(upperBound(arr, 30)).toBe(3);
    expect(upperBound(arr, 25)).toBe(2);
  });

  it('returns length when target >= all', () => {
    const arr = new Float64Array([10, 20, 30]);
    expect(upperBound(arr, 30)).toBe(3);
  });
});

describe('niceStep', () => {
  it('snaps to nice numbers', () => {
    expect(niceStep(0.3)).toBe(0.5);
    expect(niceStep(0.7)).toBe(1);
    expect(niceStep(1.5)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(15)).toBe(20);
    expect(niceStep(23)).toBe(25);
    expect(niceStep(45)).toBe(50);
    expect(niceStep(80)).toBe(100);
  });

  it('handles very small steps', () => {
    expect(niceStep(0.003)).toBe(0.005);
    expect(niceStep(0.015)).toBe(0.02);
  });

  it('handles zero or negative', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-5)).toBe(1);
  });
});

describe('niceGridValues', () => {
  it('generates evenly spaced nice values', () => {
    const values = niceGridValues(0, 100, 5);
    expect(values.length).toBeGreaterThan(0);
    expect(values[0]).toBeGreaterThanOrEqual(0);
    expect(values[values.length - 1]).toBeLessThanOrEqual(100);
  });

  it('handles zero range', () => {
    const values = niceGridValues(50, 50);
    expect(values).toEqual([50]);
  });
});

describe('formatPrice', () => {
  it('formats large prices with 2 decimals', () => {
    expect(formatPrice(45000.123)).toBe('45000.12');
  });

  it('formats medium prices with 4 decimals', () => {
    expect(formatPrice(1.23456)).toBe('1.2346');
  });

  it('formats small prices with more decimals', () => {
    expect(formatPrice(0.05)).toBe('0.050000');
  });

  it('formats very small prices with 8 decimals', () => {
    expect(formatPrice(0.00012345)).toBe('0.00012345');
  });
});

describe('formatVolume', () => {
  it('formats billions', () => {
    expect(formatVolume(1.5e9)).toBe('1.50B');
  });

  it('formats millions', () => {
    expect(formatVolume(2.3e6)).toBe('2.30M');
  });

  it('formats thousands', () => {
    expect(formatVolume(4500)).toBe('4.50K');
  });

  it('formats small numbers', () => {
    expect(formatVolume(123)).toBe('123.00');
  });
});

describe('formatTime', () => {
  // 2024-01-15 14:30:00 UTC = 1705328200
  const ts = 1705328200;

  it('formats intraday as HH:MM', () => {
    expect(formatTime(ts, '1m')).toMatch(/^\d{2}:\d{2}$/);
  });

  it('formats daily as DD MMM', () => {
    expect(formatTime(ts, '1D')).toMatch(/^\d+ \w{3}$/);
  });

  it('formats weekly with year', () => {
    expect(formatTime(ts, '1W')).toMatch(/^\d+ \w{3} \d{4}$/);
  });
});

describe('computeLayout', () => {
  it('computes correct dimensions', () => {
    const layout = computeLayout(800, 600);
    expect(layout.width).toBe(800);
    expect(layout.height).toBe(600);
    expect(layout.chartRight).toBe(800 - 80); // PRICE_AXIS_WIDTH
    expect(layout.chartBottom).toBe(600 - 30); // TIME_AXIS_HEIGHT
    expect(layout.volumeBottom).toBe(layout.chartBottom);
    expect(layout.volumeTop).toBeLessThan(layout.volumeBottom);
    expect(layout.priceAxisWidth).toBe(80);
    expect(layout.timeAxisHeight).toBe(30);
  });
});

describe('clamp', () => {
  it('clamps values', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('resolveTheme', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('returns dark theme for undefined', () => {
    expect(resolveTheme(undefined)).toEqual(DARK_THEME);
  });

  it('returns dark theme for "dark"', () => {
    expect(resolveTheme('dark')).toEqual(DARK_THEME);
  });

  it('returns light theme for "light"', () => {
    expect(resolveTheme('light')).toEqual(LIGHT_THEME);
  });

  it('passes through custom ThemeColors object', () => {
    const custom = { ...DARK_THEME, background: '#123456' };
    expect(resolveTheme(custom)).toEqual(custom);
  });

  it('resolveTheme("auto") picks light when prefers-color-scheme is light', () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('light'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    expect(resolveTheme('auto')).toEqual(LIGHT_THEME);
  });

  it('resolveTheme("auto") falls back to dark when prefers-color-scheme is dark', () => {
    window.matchMedia = ((query: string) => ({
      matches: false, // neither light nor dark match → fall through
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    expect(resolveTheme('auto')).toEqual(DARK_THEME);
  });

  it('resolveTheme("auto") degrades to dark when matchMedia throws', () => {
    window.matchMedia = (() => {
      throw new Error('not supported');
    }) as unknown as typeof window.matchMedia;

    expect(resolveTheme('auto')).toEqual(DARK_THEME);
  });
});
