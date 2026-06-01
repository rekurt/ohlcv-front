import { describe, it, expect } from 'vitest';
import {
  createPriceFormatter,
  createVolumeFormatter,
  createDateFormatter,
  formatPercentLocale,
  resolutionToDateResolution,
} from './format';

describe('createPriceFormatter', () => {
  it('uses locale-specific separators (de-DE vs en-US)', () => {
    const de = createPriceFormatter('de-DE');
    const en = createPriceFormatter('en-US');
    // 1234.5 → de groups with '.' and decimal ',' ; en groups with ',' and decimal '.'
    const deOut = de(1234.5);
    const enOut = en(1234.5);
    expect(deOut).not.toBe(enOut);
    // en-US: thousands comma, dot decimal, 2 fraction digits for >= 1000.
    expect(enOut).toBe('1,234.50');
    // de-DE: thousands dot, comma decimal.
    expect(deOut).toBe('1.234,50');
  });

  it('preserves auto-precision tiers (more decimals for small magnitudes)', () => {
    const en = createPriceFormatter('en-US');
    // >= 1000 → 2 digits; [1,1000) → 4; [0.01,1) → 6; < 0.01 → 8
    expect(en(45000.123)).toBe('45,000.12');
    expect(en(1.23456)).toBe('1.2346');
    expect(en(0.05)).toBe('0.050000');
    expect(en(0.00012345)).toBe('0.00012345');
  });

  it('honors a fixed precision option', () => {
    const en = createPriceFormatter('en-US', { precision: 0 });
    expect(en(1234.9)).toBe('1,235');
    const de = createPriceFormatter('de-DE', { precision: 3 });
    expect(de(1.5)).toBe('1,500');
  });

  it('returns empty string for non-finite input', () => {
    const en = createPriceFormatter('en-US');
    expect(en(NaN)).toBe('');
    expect(en(Infinity)).toBe('');
    const fixed = createPriceFormatter('en-US', { precision: 2 });
    expect(fixed(NaN)).toBe('');
  });

  it('falls back to the runtime default locale on a malformed tag', () => {
    // A bad BCP-47 tag must not throw; it should still format a number.
    const fmt = createPriceFormatter('not a locale!!');
    expect(typeof fmt(1234.5)).toBe('string');
    expect(fmt(1234.5).length).toBeGreaterThan(0);
  });
});

describe('createVolumeFormatter', () => {
  it('produces compact notation localized per locale', () => {
    const en = createVolumeFormatter('en-US');
    expect(en(1_500_000)).toBe('1.5M');
    expect(en(2_300)).toBe('2.3K');
    expect(en(1_100_000_000)).toBe('1.1B');
  });

  it('differs across locales for the same magnitude', () => {
    const en = createVolumeFormatter('en-US');
    const de = createVolumeFormatter('de-DE');
    // de-DE compact uses "Mio." / "Mrd." rather than M/B.
    expect(de(1_500_000)).not.toBe(en(1_500_000));
  });

  it('returns empty string for non-finite input', () => {
    const en = createVolumeFormatter('en-US');
    expect(en(NaN)).toBe('');
  });
});

describe('createDateFormatter', () => {
  // 2024-01-15 14:30:00 UTC (Date.UTC(2024, 0, 15, 14, 30, 0) / 1000)
  const ts = 1705329000;

  it('formats intraday as HH:mm (24h) in UTC', () => {
    const en = createDateFormatter('en-US', 'intraday');
    expect(en(ts)).toBe('14:30');
  });

  it('formats day resolution as day + month', () => {
    const en = createDateFormatter('en-US', 'day');
    // en-US short → "Jan 15"
    expect(en(ts)).toMatch(/Jan/);
    expect(en(ts)).toMatch(/15/);
  });

  it('formats month resolution with the year', () => {
    const en = createDateFormatter('en-US', 'month');
    expect(en(ts)).toMatch(/2024/);
  });

  it('localizes month names (de-DE differs from en-US)', () => {
    const en = createDateFormatter('en-US', 'day');
    const de = createDateFormatter('de-DE', 'day');
    expect(de(ts)).not.toBe(en(ts));
  });

  it('maps a chart resolution string to the right bucket', () => {
    // '1D' → day, '1W'/'1M' → month, anything else → intraday.
    const day = createDateFormatter('en-US', '1D');
    const month = createDateFormatter('en-US', '1W');
    const intraday = createDateFormatter('en-US', '15m');
    expect(day(ts)).toMatch(/Jan/);
    expect(month(ts)).toMatch(/2024/);
    expect(intraday(ts)).toBe('14:30');
  });

  it('returns empty string for non-finite / invalid timestamps', () => {
    const en = createDateFormatter('en-US', 'intraday');
    expect(en(NaN)).toBe('');
    expect(en(Infinity)).toBe('');
    expect(en(-Infinity)).toBe('');
  });
});

describe('resolutionToDateResolution', () => {
  it('buckets resolutions', () => {
    expect(resolutionToDateResolution('1W')).toBe('month');
    expect(resolutionToDateResolution('1M')).toBe('month');
    expect(resolutionToDateResolution('1D')).toBe('day');
    expect(resolutionToDateResolution('1m')).toBe('intraday');
    expect(resolutionToDateResolution('1H')).toBe('intraday');
    expect(resolutionToDateResolution('')).toBe('intraday');
  });
});

describe('formatPercentLocale', () => {
  it('shows a sign and two fraction digits', () => {
    // en-US percent style: trailing % with no space.
    expect(formatPercentLocale(12.3, 'en-US')).toBe('+12.30%');
    expect(formatPercentLocale(-5, 'en-US')).toBe('-5.00%');
  });

  it('does not sign zero', () => {
    expect(formatPercentLocale(0, 'en-US')).toBe('0.00%');
  });

  it('localizes the decimal separator', () => {
    // de-DE uses a comma decimal and a narrow no-break space before %.
    const out = formatPercentLocale(12.3, 'de-DE');
    expect(out).toMatch(/12,30/);
    expect(out).toMatch(/%/);
  });

  it('returns empty string for non-finite input', () => {
    expect(formatPercentLocale(NaN, 'en-US')).toBe('');
    expect(formatPercentLocale(Infinity, 'en-US')).toBe('');
  });
});
