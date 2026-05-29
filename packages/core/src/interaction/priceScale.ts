/**
 * Price-scale transform core (F1).
 *
 * The viewport maps a price to a Y pixel in two composable steps:
 *
 *   price ──priceToTransformed──▶ t ──linear pixel map──▶ y
 *
 * Only the first step varies per mode; the linear pixel map (in
 * `Viewport.priceToY`) is shared. This keeps log / percentage /
 * indexed scaling localized to two pure, fully-testable functions and
 * means every downstream consumer of `priceToY`/`yToPrice` (candles,
 * overlay indicators, drawings, markers, crosshair, price lines)
 * inherits scale-mode correctness for free.
 *
 * `linear` is the identity transform, so the linear render path is
 * bit-for-bit unchanged from before F1.
 */
export type PriceScaleMode = 'linear' | 'log' | 'percentage' | 'indexedTo100';

/**
 * Smallest positive value substituted for non-positive prices in log
 * space (log is undefined at 0). Mirrors the guard already shipped and
 * tested in `rendering/Pane.ts`.
 */
export const LOG_MIN_POSITIVE = 1e-9;

/**
 * Map a price into the mode's transformed coordinate. `base` is the
 * percentage/indexed anchor (the first visible candle's close); it is
 * ignored by `linear` and `log`.
 *
 * Must never return NaN/±Infinity for finite inputs — a poisoned
 * transformed value would corrupt every pixel that flows through the
 * shared linear map.
 */
export function priceToTransformed(price: number, mode: PriceScaleMode, base: number): number {
  switch (mode) {
    case 'log': {
      const p = price > 0 ? price : LOG_MIN_POSITIVE;
      return Math.log(p);
    }
    case 'percentage':
      // Fractional change vs. base, expressed in percent. Affine in
      // price, so linear-space autoscale padding stays proportional.
      return base === 0 ? 0 : ((price - base) / base) * 100;
    case 'indexedTo100':
      return base === 0 ? 100 : (price / base) * 100;
    case 'linear':
    default:
      return price;
  }
}

/** Inverse of {@link priceToTransformed}. */
export function transformedToPrice(t: number, mode: PriceScaleMode, base: number): number {
  switch (mode) {
    case 'log':
      return Math.exp(t);
    case 'percentage':
      return base === 0 ? t : base * (1 + t / 100);
    case 'indexedTo100':
      return base === 0 ? t : (t / 100) * base;
    case 'linear':
    default:
      return t;
  }
}
