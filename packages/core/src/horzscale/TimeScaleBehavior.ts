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

  toLogical(time: number, buffer: CandleBuffer): number {
    return buffer.findIndexByTime(time);
  }

  fromLogical(logical: number, buffer: CandleBuffer): number | null {
    const candle = buffer.candleAt(Math.round(logical));
    return candle ? candle.t : null;
  }

  formatValue(time: number): string {
    return formatTime(time, this._resolution);
  }
}
