import type { ChartLayout, ThemeColors, ThemeMode } from './types';
import {
  PRICE_AXIS_WIDTH,
  TIME_AXIS_HEIGHT,
  VOLUME_HEIGHT_RATIO,
  INDICATOR_PANE_HEIGHT,
  MIN_MAIN_AREA_HEIGHT,
  DARK_THEME,
  LIGHT_THEME,
} from './constants';

/** Binary search: first index where arr[i] >= target */
export function lowerBound(arr: Float64Array, target: number, start = 0, end = arr.length): number {
  let lo = start;
  let hi = end;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    // mid is always in [lo, hi) ⊂ [start, end) ⊂ [0, arr.length)
    if (arr[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Binary search: first index where arr[i] > target */
export function upperBound(arr: Float64Array, target: number, start = 0, end = arr.length): number {
  let lo = start;
  let hi = end;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    // mid is always in [lo, hi) ⊂ [start, end) ⊂ [0, arr.length)
    if (arr[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Snap a raw step to a "nice" number: 1, 2, 2.5, 5 × 10^n */
export function niceStep(rawStep: number): number {
  if (rawStep <= 0) return 1;
  const exp = Math.floor(Math.log10(rawStep));
  const base = Math.pow(10, exp);
  const frac = rawStep / base;

  let nice: number;
  if (frac <= 1) nice = 1;
  else if (frac <= 2) nice = 2;
  else if (frac <= 2.5) nice = 2.5;
  else if (frac <= 5) nice = 5;
  else nice = 10;

  return nice * base;
}

/** Generate nice grid values between min and max */
export function niceGridValues(min: number, max: number, maxTicks = 8): number[] {
  const range = max - min;
  if (range <= 0) return [min];

  const rawStep = range / maxTicks;
  const step = niceStep(rawStep);
  const start = Math.ceil(min / step) * step;
  const values: number[] = [];

  for (let v = start; v <= max; v += step) {
    values.push(v);
  }
  return values;
}

/**
 * Generate logarithmically-spaced "nice" grid values (1, 2, 5 × 10^n)
 * spanning [min, max]. Used by the log price-scale mode so axis ticks
 * land on round decade multiples instead of evenly-spaced prices.
 *
 * Falls back to {@link niceGridValues} when the range is non-positive,
 * `min` is not strictly positive, or the decade walk yields fewer than
 * three ticks (a tight zoom inside a single decade — linear nice values
 * read better there).
 */
export function niceLogGridValues(min: number, max: number, maxTicks = 6): number[] {
  if (!(max > min) || min <= 0) {
    return niceGridValues(Math.max(min, LOG_AXIS_FLOOR), Math.max(max, LOG_AXIS_FLOOR), maxTicks);
  }

  const loExp = Math.floor(Math.log10(min));
  const hiExp = Math.ceil(Math.log10(max));
  const decades = hiExp - loExp;

  // Thin the tick density to roughly `maxTicks`, so a wide log range doesn't
  // emit dozens of overlapping lines/labels:
  //   - narrow span → full 1/2/5 per decade
  //   - medium span → one tick per decade (powers of 10)
  //   - very wide span → one tick every N decades
  let mantissas: number[];
  let decadeStep = 1;
  if (decades * 3 <= maxTicks) {
    mantissas = [1, 2, 5];
  } else if (decades <= maxTicks) {
    mantissas = [1];
  } else {
    mantissas = [1];
    decadeStep = Math.ceil(decades / maxTicks);
  }

  const values: number[] = [];
  for (let exp = loExp; exp <= hiExp; exp += decadeStep) {
    const decade = Math.pow(10, exp);
    for (const m of mantissas) {
      const v = m * decade;
      if (v >= min && v <= max) values.push(v);
    }
  }

  if (values.length < 3) return niceGridValues(min, max, maxTicks);
  return values;
}

/** Smallest positive value used to clamp a log axis with a bad lower bound. */
const LOG_AXIS_FLOOR = 1e-9;

/** Format a signed percentage for the percentage/indexed price-scale axis. */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/** Format price with auto-precision */
export function formatPrice(price: number): string {
  if (Math.abs(price) >= 1000) return price.toFixed(2);
  if (Math.abs(price) >= 1) return price.toFixed(4);
  if (Math.abs(price) >= 0.01) return price.toFixed(6);
  return price.toFixed(8);
}

/** Format volume with K/M/B suffixes */
export function formatVolume(volume: number): string {
  if (volume >= 1e9) return (volume / 1e9).toFixed(2) + 'B';
  if (volume >= 1e6) return (volume / 1e6).toFixed(2) + 'M';
  if (volume >= 1e3) return (volume / 1e3).toFixed(2) + 'K';
  return volume.toFixed(2);
}

/** Format time based on resolution */
export function formatTime(timestamp: number, resolution: string): string {
  // Guard against NaN/Infinity timestamps from corrupted feeds —
  // rendering 'Invalid Date' / undefined month name into the axis
  // was crashing canvas measureText on some browsers.
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  if (resolution === '1W' || resolution === '1M') {
    return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  }
  if (resolution === '1D') {
    return `${date.getUTCDate()} ${months[date.getUTCMonth()]}`;
  }
  // Intraday
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Compute chart layout from container dimensions.
 *
 * `paneCount` is the number of sub-pane indicator bands stacked
 * under the main chart area. Each consumes `INDICATOR_PANE_HEIGHT`
 * px vertically. We cap the total reserved height so the main area
 * never shrinks below `MIN_MAIN_AREA_HEIGHT` — if the user asks for
 * more panes than fit, panes are simply rendered shorter.
 *
 * `hasLeftAxis` (B2) reserves a `PRICE_AXIS_WIDTH` strip on the LEFT for
 * the optional secondary price axis and shifts `chartLeft` right by that
 * much. It defaults to `false`, so the common single-axis layout is
 * byte-for-byte identical (`leftAxisWidth: 0`, `chartLeft: 0`).
 */
export function computeLayout(
  width: number,
  height: number,
  paneCount = 0,
  hasLeftAxis = false,
): ChartLayout {
  const priceAxisWidth = PRICE_AXIS_WIDTH;
  const timeAxisHeight = TIME_AXIS_HEIGHT;
  const leftAxisWidth = hasLeftAxis ? PRICE_AXIS_WIDTH : 0;
  const chartLeft = leftAxisWidth;
  const chartRight = width - priceAxisWidth;
  const chartTop = 0;
  const paneAreaBottom = height - timeAxisHeight;

  // Reserve space for sub-pane bands, but keep the main area no
  // smaller than MIN_MAIN_AREA_HEIGHT.
  const desiredPanesHeight = paneCount * INDICATOR_PANE_HEIGHT;
  const maxPanesHeight = Math.max(0, paneAreaBottom - chartTop - MIN_MAIN_AREA_HEIGHT);
  const panesHeight = Math.min(desiredPanesHeight, maxPanesHeight);

  const chartBottom = paneAreaBottom - panesHeight;
  const paneAreaTop = chartBottom;
  const chartHeight = chartBottom - chartTop;
  const volumeTop = chartBottom - chartHeight * VOLUME_HEIGHT_RATIO;
  const volumeBottom = chartBottom;

  return {
    width,
    height,
    chartTop,
    chartBottom,
    chartLeft,
    chartRight,
    volumeTop,
    volumeBottom,
    priceAxisWidth,
    leftAxisWidth,
    timeAxisHeight,
    paneAreaTop,
    paneAreaBottom,
    paneCount,
  };
}

/** Clamp a value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Resolve theme from mode or custom colors.
 *
 * `'auto'` follows the user's `prefers-color-scheme` media query. This
 * degrades gracefully to `'dark'` in environments without `window.matchMedia`
 * (SSR, tests, non-browser runtimes).
 */
export function resolveTheme(theme: ThemeMode | ThemeColors | undefined): ThemeColors {
  if (!theme) return { ...DARK_THEME };
  if (theme === 'dark') return { ...DARK_THEME };
  if (theme === 'light') return { ...LIGHT_THEME };
  if (theme === 'auto') {
    return prefersLightColorScheme() ? { ...LIGHT_THEME } : { ...DARK_THEME };
  }
  return { ...theme };
}

/** True if the OS/browser is currently requesting a light UI. */
function prefersLightColorScheme(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches;
  } catch {
    return false;
  }
}

/** Create a canvas with HiDPI scaling */
export function createHiDPICanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.scale(dpr, dpr);
  return canvas;
}

/** Resize an existing canvas with HiDPI scaling */
export function resizeHiDPICanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.scale(dpr, dpr);
}
