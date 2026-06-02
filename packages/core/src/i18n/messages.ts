/**
 * Translatable UI strings + the {@link createI18n} factory that bundles them
 * with the locale-aware number/date formatters (C6 — "full i18n").
 *
 * Why this exists: lightweight-charts has no real localization story — axis
 * numbers/dates aren't `Intl`-formatted and the (sparse) a11y text isn't
 * translatable. Here the host passes `ChartConfig.locale` (BCP-47) and an
 * optional `ChartConfig.messages` override map; the chart then renders
 * numbers/dates in that locale and speaks localized labels to screen readers.
 *
 * Backwards compatibility: {@link DEFAULT_MESSAGES} reproduces the previous
 * hard-coded English strings exactly, and an i18n built with no `locale`
 * routes prices/volume/time through the locale-agnostic `utils` formatters —
 * so a chart that doesn't opt in is byte-for-byte unchanged.
 */
import {
  formatPrice as defaultFormatPrice,
  formatVolume as defaultFormatVolume,
  formatTime as defaultFormatTime,
  formatPercent as defaultFormatPercent,
} from '../utils';
import {
  createPriceFormatter,
  createVolumeFormatter,
  createDateFormatter,
  formatPercentLocale,
  resolutionToDateResolution,
  type NumberFormatFn,
} from './format';

/**
 * The full set of translatable strings the chart renders. Every key has an
 * English default in {@link DEFAULT_MESSAGES}; a host overrides any subset via
 * `ChartConfig.messages` and falls back to the default for the rest.
 *
 * Naming: `a11y*` are screen-reader strings, `legend*` are the single-letter
 * OHLCV legend labels, and the rest are visible UI chrome.
 */
export interface Messages {
  /** `aria-label` on the focusable chart canvas (announced on focus). */
  a11yChartLabel: string;
  /** Hint appended after the label describing keyboard controls. */
  a11yChartHint: string;
  /** Word for "open" in the crosshair OHLC live-region announcement. */
  a11yOpen: string;
  /** Word for "high" in the crosshair OHLC live-region announcement. */
  a11yHigh: string;
  /** Word for "low" in the crosshair OHLC live-region announcement. */
  a11yLow: string;
  /** Word for "close" in the crosshair OHLC live-region announcement. */
  a11yClose: string;
  /** Legend label for the open price (single letter in en). */
  legendOpen: string;
  /** Legend label for the high price. */
  legendHigh: string;
  /** Legend label for the low price. */
  legendLow: string;
  /** Legend label for the close price. */
  legendClose: string;
  /** Legend label for volume. */
  legendVolume: string;
  /** Text of the floating "scroll back to the live edge" pill. */
  goToLive: string;
}

/**
 * English defaults — these reproduce the strings the chart previously
 * hard-coded (the `aria-label`, the `open/high/low/close` announcement words,
 * the `O/H/L/C/V` legend letters, and the `Go to live ▶` pill), so a chart
 * with no `messages` override renders identically to before C6.
 */
export const DEFAULT_MESSAGES: Messages = {
  a11yChartLabel: 'OHLCV price chart.',
  a11yChartHint: 'Use arrow keys to pan, plus and minus to zoom, Home and End to jump.',
  a11yOpen: 'open',
  a11yHigh: 'high',
  a11yLow: 'low',
  a11yClose: 'close',
  legendOpen: 'O',
  legendHigh: 'H',
  legendLow: 'L',
  legendClose: 'C',
  legendVolume: 'V',
  goToLive: 'Go to live ▶',
};

/**
 * The runtime i18n bundle the chart uses internally: translated string lookup
 * (`t`) plus locale-aware number/date/percent formatters bound to the
 * configured `locale`. Built by {@link createI18n}.
 */
export interface I18n {
  /** The resolved messages (defaults merged with the host's overrides). */
  readonly messages: Messages;
  /** The configured BCP-47 locale, or `undefined` for the runtime default. */
  readonly locale: string | undefined;
  /** Look up a translatable string by key (override → default). */
  t(key: keyof Messages): string;
  /** Format a price for this locale (auto-precision). */
  price: NumberFormatFn;
  /** Format a volume for this locale (compact K/M/B). */
  volume: NumberFormatFn;
  /** Format a Unix-seconds timestamp for this locale at the given resolution. */
  date(timestamp: number, resolution: string): string;
  /** Format a signed percentage for this locale. */
  percent(value: number): string;
}

/**
 * Build an {@link I18n} bundle.
 *
 * `locale` is a BCP-47 tag (e.g. `'de-DE'`); when omitted the formatters use
 * the locale-agnostic `utils` defaults (`formatPrice` etc.) so the chart stays
 * byte-for-byte identical to the pre-C6 behavior — opting into i18n is
 * explicit. `overrides` patches any subset of {@link Messages}; unspecified
 * keys fall back to {@link DEFAULT_MESSAGES}.
 *
 * The returned `date` memoizes one `Intl.DateTimeFormat` per distinct
 * resolution bucket so axis rendering doesn't reallocate per label.
 */
export function createI18n(locale?: string, overrides?: Partial<Messages>): I18n {
  const messages: Messages = overrides
    ? { ...DEFAULT_MESSAGES, ...overrides }
    : DEFAULT_MESSAGES;

  // No locale → keep the exact legacy (non-Intl) formatters. This is the
  // default path; it costs nothing extra and can't drift from `utils`.
  if (locale === undefined) {
    return {
      messages,
      locale,
      t: (key) => messages[key],
      price: defaultFormatPrice,
      volume: defaultFormatVolume,
      date: (timestamp, resolution) => defaultFormatTime(timestamp, resolution),
      percent: defaultFormatPercent,
    };
  }

  // Locale-aware path. Price/volume formatters are locale-stable, so build
  // them once. Date formatters depend on the (mutable) resolution, so cache
  // one per resolution bucket on demand.
  const price = createPriceFormatter(locale);
  const volume = createVolumeFormatter(locale);
  const dateCache = new Map<string, (timestamp: number) => string>();

  return {
    messages,
    locale,
    t: (key) => messages[key],
    price,
    volume,
    date(timestamp, resolution) {
      const bucket = resolutionToDateResolution(resolution);
      let fmt = dateCache.get(bucket);
      if (!fmt) {
        fmt = createDateFormatter(locale, bucket);
        dateCache.set(bucket, fmt);
      }
      return fmt(timestamp);
    },
    percent: (value) => formatPercentLocale(value, locale),
  };
}
