import type { CandleBuffer } from '../data/CandleBuffer';
import { formatPrice } from '../utils';
import type { HorzScaleBehavior } from './HorzScaleBehavior';

/**
 * Numeric horizontal-scale behavior for options-style charts where X is a
 * price (strike), not time. The host stores the strike in each candle's `t`
 * field, ascending; this behavior labels the axis with formatted prices.
 *
 * Geometry stays uniform-by-index (evenly-spaced strikes render correctly);
 * proportional spacing for non-uniform strikes is a future `domainToCoord01`
 * extension.
 */
export class PriceScaleBehavior implements HorzScaleBehavior<number> {
  readonly uniform = true;
  private _format: (value: number) => string;

  constructor(format: (value: number) => string = formatPrice) {
    this._format = format;
  }

  toLogical(value: number, buffer: CandleBuffer): number {
    // `t` holds the (ascending) strike; reuse the buffer's time index search.
    return buffer.findIndexByTime(value);
  }

  fromLogical(logical: number, buffer: CandleBuffer): number | null {
    const candle = buffer.candleAt(Math.round(logical));
    return candle ? candle.t : null;
  }

  formatValue(value: number): string {
    return this._format(value);
  }
}
