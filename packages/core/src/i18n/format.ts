/**
 * Locale-aware number / date formatters built on the platform `Intl` APIs.
 *
 * These are the i18n (C6) counterparts to the locale-agnostic
 * `formatPrice` / `formatVolume` / `formatTime` in `../utils`. The plain
 * functions there stay byte-for-byte stable (and remain the default render
 * path); these factories are used only when a host supplies a `locale`
 * (or `messages`) on `ChartConfig`, so existing charts are unaffected.
 *
 * Every factory tolerates an unsupported/garbage locale: `Intl` throws a
 * `RangeError` on a malformed BCP-47 tag, so each constructor falls back to
 * the runtime default locale (and, if even that fails, to the locale-agnostic
 * util) rather than letting a bad config crash the chart.
 */
import { formatVolume as defaultFormatVolume } from '../utils';

/** A function that turns a finite number into a display string. */
export type NumberFormatFn = (value: number) => string;
/** A function that turns a Unix-seconds timestamp into a display string. */
export type DateFormatFn = (timestamp: number) => string;

/**
 * Mirror `formatPrice`'s auto-precision tiers (2 / 4 / 6 / 8 decimals by
 * magnitude) so a locale-aware price still shows the right number of
 * significant decimals for sub-dollar / micro-cap assets — only the grouping
 * + decimal separators become locale-sensitive.
 */
function autoPrecision(price: number): number {
  const abs = Math.abs(price);
  if (abs >= 1000) return 2;
  if (abs >= 1) return 4;
  if (abs >= 0.01) return 6;
  return 8;
}

/** Best-effort `Intl.NumberFormat`; `undefined` if even the default locale fails. */
function tryNumberFormat(
  locale: string | undefined,
  opts: Intl.NumberFormatOptions,
): Intl.NumberFormat | undefined {
  try {
    return new Intl.NumberFormat(locale, opts);
  } catch {
    try {
      // Drop a bad locale tag but keep the requested options.
      return new Intl.NumberFormat(undefined, opts);
    } catch {
      return undefined;
    }
  }
}

/**
 * A locale-aware price formatter. Uses `Intl.NumberFormat` with the same
 * auto-precision tiers as `formatPrice` so digit counts match
 * across locales — only separators localize. Pass a fixed `precision` to pin
 * the fraction digits (e.g. an instrument with a known tick size).
 *
 * Non-finite input → `''` (matches the axis-safe behavior of the default).
 */
export function createPriceFormatter(
  locale?: string,
  opts?: { precision?: number },
): NumberFormatFn {
  const fixed = opts?.precision;

  // Fixed precision: a single reusable formatter.
  if (fixed !== undefined) {
    const nf = tryNumberFormat(locale, {
      minimumFractionDigits: fixed,
      maximumFractionDigits: fixed,
    });
    if (!nf) return (v) => (Number.isFinite(v) ? v.toFixed(fixed) : '');
    return (v) => (Number.isFinite(v) ? nf.format(v) : '');
  }

  // Auto precision: cache one formatter per tier (4 tiers) so a hover sweep
  // doesn't allocate an Intl.NumberFormat per frame.
  const cache = new Map<number, Intl.NumberFormat | null>();
  return (v) => {
    if (!Number.isFinite(v)) return '';
    const digits = autoPrecision(v);
    let nf = cache.get(digits);
    if (nf === undefined) {
      nf =
        tryNumberFormat(locale, {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        }) ?? null;
      cache.set(digits, nf);
    }
    return nf ? nf.format(v) : v.toFixed(digits);
  };
}

/**
 * A locale-aware volume formatter using compact notation (`1.2K`, `3.4M`,
 * `1.1B`) localized by `Intl.NumberFormat({ notation: 'compact' })`. Locales
 * that don't use Latin compact suffixes (e.g. some CJK locales) get their
 * native compact forms. Falls back to {@link defaultFormatVolume} when
 * `Intl` can't honor the request.
 *
 * Non-finite input → `''`.
 */
export function createVolumeFormatter(locale?: string): NumberFormatFn {
  const nf = tryNumberFormat(locale, {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 2,
  });
  if (!nf) return (v) => (Number.isFinite(v) ? defaultFormatVolume(v) : '');
  return (v) => (Number.isFinite(v) ? nf.format(v) : '');
}

/**
 * A locale-aware percentage formatter. Always shows a sign (a leading `+`
 * for positive values, matching {@link formatPercent}'s convention) and two
 * fraction digits. `value` is a percent already (e.g. `12.3` → `+12.30 %`),
 * so we format `value / 100` through the `percent` style and let the locale
 * decide separator + space-before-`%`.
 *
 * Non-finite input → `''`.
 */
export function formatPercentLocale(value: number, locale?: string): string {
  if (!Number.isFinite(value)) return '';
  const nf = tryNumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: 'exceptZero',
  });
  if (!nf) {
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  }
  return nf.format(value / 100);
}

/**
 * Time resolution buckets that drive {@link createDateFormatter}'s output
 * shape. `intraday` shows `HH:mm`; `day` shows a day+month date; `month`
 * shows a month+year date — matching the three branches of the default
 * {@link formatTime} but rendered through `Intl.DateTimeFormat` in the host
 * locale and (by default) UTC, so a German chart reads `14:30` / `15. Jan.`
 * while a US chart reads `2:30 PM` / `Jan 15`.
 */
export type DateResolution = 'intraday' | 'day' | 'month';

/**
 * Map a chart resolution string (`'1m'`, `'1H'`, `'1D'`, `'1W'`, `'1M'`) to a
 * {@link DateResolution} bucket. Weekly/monthly → `month` (date + year),
 * daily → `day` (day + month), everything else (intraday) → `intraday`.
 * Mirrors the branch structure of the default {@link formatTime}.
 */
export function resolutionToDateResolution(resolution: string): DateResolution {
  if (resolution === '1W' || resolution === '1M') return 'month';
  if (resolution === '1D') return 'day';
  return 'intraday';
}

/** Best-effort `Intl.DateTimeFormat`; `undefined` if even the default locale fails. */
function tryDateFormat(
  locale: string | undefined,
  opts: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat | undefined {
  try {
    return new Intl.DateTimeFormat(locale, opts);
  } catch {
    try {
      return new Intl.DateTimeFormat(undefined, opts);
    } catch {
      return undefined;
    }
  }
}

/**
 * A locale-aware time-axis / tooltip formatter. Returns a function mapping a
 * Unix-seconds timestamp to a localized label whose granularity follows
 * `resolution` (see {@link DateResolution}). Times are rendered in UTC to
 * match the default {@link formatTime} (and because OHLCV candle times are
 * exchange-UTC); pass a `timeZone` to override.
 *
 * Non-finite / invalid timestamps → `''` (axis-safe, like the default).
 */
export function createDateFormatter(
  locale?: string,
  resolution: DateResolution | string = 'intraday',
  timeZone = 'UTC',
): DateFormatFn {
  const res =
    resolution === 'intraday' || resolution === 'day' || resolution === 'month'
      ? resolution
      : resolutionToDateResolution(resolution);

  // Validate the timeZone up front. A bad one (e.g. 'Mars/Phobos') makes every
  // Intl.DateTimeFormat below throw, and the locale-fallback reuses the same
  // opts (same bad timeZone) → silent loss of ALL date labels. Drop to UTC.
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }

  let opts: Intl.DateTimeFormatOptions;
  if (res === 'month') {
    opts = { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz };
  } else if (res === 'day') {
    opts = { day: 'numeric', month: 'short', timeZone: tz };
  } else {
    opts = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz };
  }

  const df = tryDateFormat(locale, opts);
  return (timestamp) => {
    if (!Number.isFinite(timestamp)) return '';
    const date = new Date(timestamp * 1000);
    if (Number.isNaN(date.getTime())) return '';
    if (!df) {
      // Last-resort fallback: an ISO-ish slice (should never hit in practice
      // since Intl.DateTimeFormat with no locale is universally supported).
      return date.toISOString();
    }
    return df.format(date);
  };
}
