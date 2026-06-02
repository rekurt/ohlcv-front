import { describe, it, expect } from 'vitest';
import { createI18n, DEFAULT_MESSAGES } from './messages';
import { formatPrice, formatVolume, formatTime, formatPercent } from '../utils';

describe('createI18n — message lookup', () => {
  it('t() returns the default when no override is given', () => {
    const i18n = createI18n();
    expect(i18n.t('goToLive')).toBe(DEFAULT_MESSAGES.goToLive);
    expect(i18n.t('a11yOpen')).toBe('open');
    expect(i18n.t('legendClose')).toBe('C');
  });

  it('t() returns the override when one is given, default otherwise (fallback)', () => {
    const i18n = createI18n(undefined, {
      goToLive: 'В эфир ▶',
      a11yOpen: 'открытие',
    });
    // Overridden keys.
    expect(i18n.t('goToLive')).toBe('В эфир ▶');
    expect(i18n.t('a11yOpen')).toBe('открытие');
    // Non-overridden keys fall back to the English default.
    expect(i18n.t('a11yClose')).toBe('close');
    expect(i18n.t('legendVolume')).toBe('V');
  });

  it('exposes the merged messages and the configured locale', () => {
    const i18n = createI18n('de-DE', { goToLive: 'Live ▶' });
    expect(i18n.locale).toBe('de-DE');
    expect(i18n.messages.goToLive).toBe('Live ▶');
    expect(i18n.messages.a11yHigh).toBe('high');
  });

  it('does not mutate DEFAULT_MESSAGES when overriding', () => {
    createI18n(undefined, { goToLive: 'changed' });
    expect(DEFAULT_MESSAGES.goToLive).toBe('Go to live ▶');
  });
});

describe('createI18n — default (no-locale) formatters match utils byte-for-byte', () => {
  const i18n = createI18n();

  it('price === formatPrice', () => {
    for (const v of [45000.123, 1.23456, 0.05, 0.00012345, 123]) {
      expect(i18n.price(v)).toBe(formatPrice(v));
    }
  });

  it('volume === formatVolume', () => {
    for (const v of [1.5e9, 2.3e6, 4500, 123]) {
      expect(i18n.volume(v)).toBe(formatVolume(v));
    }
  });

  it('date === formatTime at each resolution', () => {
    const ts = 1705329000;
    for (const res of ['1m', '15m', '1H', '1D', '1W', '1M']) {
      expect(i18n.date(ts, res)).toBe(formatTime(ts, res));
    }
  });

  it('percent === formatPercent', () => {
    for (const v of [12.3, -5, 0]) {
      expect(i18n.percent(v)).toBe(formatPercent(v));
    }
  });
});

describe('createI18n — locale-aware formatters differ from the default', () => {
  it('de-DE price uses different separators than the default', () => {
    const def = createI18n();
    const de = createI18n('de-DE');
    // Default (en-style): "45000.12"; de-DE: "45.000,12".
    expect(de.price(45000.123)).not.toBe(def.price(45000.123));
    expect(de.price(45000.123)).toBe('45.000,12');
  });

  it('de-DE vs en-US price separators differ', () => {
    const de = createI18n('de-DE');
    const en = createI18n('en-US');
    expect(de.price(1234.5)).toBe('1.234,50');
    expect(en.price(1234.5)).toBe('1,234.50');
  });

  it('date localizes per locale and resolution bucket', () => {
    const ts = 1705329000; // 2024-01-15 14:30 UTC
    const en = createI18n('en-US');
    const de = createI18n('de-DE');
    // Intraday → 24h HH:mm in both (same digits), daily month name differs.
    expect(en.date(ts, '15m')).toBe('14:30');
    expect(en.date(ts, '1D')).not.toBe(de.date(ts, '1D'));
  });

  it('memoizes a date formatter per resolution bucket (stable output)', () => {
    const en = createI18n('en-US');
    const ts = 1705329000;
    // Calling twice for the same bucket returns identical strings.
    expect(en.date(ts, '1m')).toBe(en.date(ts, '5m'));
    expect(en.date(ts, '1D')).toBe(en.date(ts, '1D'));
  });

  it('percent localizes the separator', () => {
    const de = createI18n('de-DE');
    expect(de.percent(12.3)).toMatch(/12,30/);
  });
});
