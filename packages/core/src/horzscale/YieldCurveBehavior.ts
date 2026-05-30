import type { CandleBuffer } from '../data/CandleBuffer';
import type { HorzScaleBehavior } from './HorzScaleBehavior';

/**
 * Non-uniform horizontal-scale behavior: positions each bar proportionally to
 * its domain value (the candle `t` field) instead of by uniform index. This
 * is what makes a true yield-curve chart possible — tenors at 1M, 3M, 1Y, 5Y,
 * 30Y sit at value-proportional X positions, not evenly spaced.
 *
 * `uniform = false` activates the engine's value-based geometry path
 * (`Viewport.setCoordinateMapping`); the standard uniform time/price charts
 * are unaffected.
 */
export class YieldCurveBehavior implements HorzScaleBehavior<number> {
  readonly uniform = false;
  private _format: (value: number) => string;

  constructor(format: (value: number) => string = (v) => String(v)) {
    this._format = format;
  }

  toLogical(value: number, buffer: CandleBuffer): number {
    return buffer.findIndexByTime(value);
  }

  fromLogical(logical: number, buffer: CandleBuffer): number | null {
    const candle = buffer.candleAt(Math.round(logical));
    return candle ? candle.t : null;
  }

  formatValue(value: number): string {
    return this._format(value);
  }

  /**
   * Linear-proportional position of `value` across the visible [from, to].
   * Deliberately NOT clamped to [0, 1]: off-screen domain values must map
   * outside the chart (coord < 0 or > 1) so `indexToX` returns truly
   * off-screen coordinates and the renderers' `x < chartLeft || x > chartRight`
   * culling hides off-screen candles/markers instead of piling them on the
   * edges.
   */
  domainToCoord01(value: number, from: number, to: number): number {
    const span = to - from;
    if (span === 0) return 0;
    return (value - from) / span;
  }
}
