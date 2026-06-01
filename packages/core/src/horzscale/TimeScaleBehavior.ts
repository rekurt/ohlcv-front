import type { CandleBuffer } from '../data/CandleBuffer';
import { formatTime } from '../utils';
import type { HorzScaleBehavior } from './HorzScaleBehavior';

/**
 * Default horizontal-scale behavior: the X domain is Unix-seconds time, the
 * candle's `t` field. Reproduces the pre-F7 axis exactly (labels via
 * `formatTime`), so the standard chart is unchanged.
 */
export class TimeScaleBehavior implements HorzScaleBehavior<number> {
  readonly uniform = true;
  private _resolution: string;
  /**
   * Optional locale-aware label formatter (C6). When set, `formatValue`
   * delegates to it instead of the locale-agnostic {@link formatTime}; the
   * formatter receives the Unix-seconds time and the current resolution.
   * `null` (the default) keeps the exact pre-i18n axis labels.
   */
  private _dateFormatter: ((time: number, resolution: string) => string) | null = null;

  constructor(resolution = '') {
    this._resolution = resolution;
  }

  /** Update the resolution used for label formatting. */
  setResolution(resolution: string): void {
    this._resolution = resolution;
  }

  get resolution(): string {
    return this._resolution;
  }

  /**
   * Install (or clear with `null`) a locale-aware date formatter so axis
   * labels localize. The chart wires this from its i18n bundle when a
   * `locale` is configured; with no locale it stays `null` and labels are
   * byte-for-byte the legacy {@link formatTime} output.
   */
  setDateFormatter(fn: ((time: number, resolution: string) => string) | null): void {
    this._dateFormatter = fn;
  }

  toLogical(time: number, buffer: CandleBuffer): number {
    return buffer.findIndexByTime(time);
  }

  fromLogical(logical: number, buffer: CandleBuffer): number | null {
    const candle = buffer.candleAt(Math.round(logical));
    return candle ? candle.t : null;
  }

  formatValue(time: number): string {
    if (this._dateFormatter) return this._dateFormatter(time, this._resolution);
    return formatTime(time, this._resolution);
  }
}
