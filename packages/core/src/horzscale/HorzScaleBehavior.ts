import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Pluggable behavior for the horizontal domain, abstracting the engine away
 * from "X is always time". The default {@link TimeScaleBehavior} keeps the
 * existing time axis byte-for-byte; {@link PriceScaleBehavior} drives an
 * options-style numeric X axis (strikes), and hosts can register their own.
 *
 * The engine positions bars by uniform buffer index regardless of behavior
 * (so all existing geometry/interaction is unchanged); a behavior decides
 * what each index *means* and how to label it. Truly non-uniform geometry
 * (proportional yield-curve spacing) is reserved for a future extension via
 * `domainToCoord01` + `uniform = false`.
 *
 * `T` is the domain value type (Unix seconds for time, a number for price).
 */
export interface HorzScaleBehavior<T = number> {
  /**
   * When true (all built-ins), bars are positioned by uniform buffer index
   * and `domainToCoord01` is ignored — the standard, fully-tested geometry.
   */
  readonly uniform: boolean;

  /** Map a domain value to the nearest logical buffer index. */
  toLogical(value: T, buffer: CandleBuffer): number;

  /** The domain value at a logical buffer index, or null if out of range. */
  fromLogical(logical: number, buffer: CandleBuffer): T | null;

  /** Format a domain value for the axis / crosshair / legend. */
  formatValue(value: T): string;

  /**
   * Future (non-uniform) hook: map a domain value to a 0..1 position across
   * the visible logical range, for proportional spacing. Unused while
   * `uniform` is true.
   */
  domainToCoord01?(value: T, fromLogical: number, toLogical: number): number;
}
