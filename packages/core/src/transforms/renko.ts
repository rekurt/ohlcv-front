import type { Candle } from '../types';

/**
 * Renko "bricks" are time-agnostic blocks built purely from price
 * movement. A new brick appears only after price has moved at least
 * `brickSize` from the previous brick's close.
 *
 * The output conforms to the `Candle` shape so it can feed straight
 * into OHLCVChart, but:
 *   - `t` is the timestamp of the SOURCE candle that triggered the brick
 *   - `o` is the previous brick's close
 *   - `c = o ± brickSize` (up or down)
 *   - `h`/`l` equal the extremes of `o` and `c`
 *   - `v` is 0 (bricks don't correspond to a single source bar)
 *
 * This is the classic "one brick per move" variant — gaps larger than
 * `brickSize` emit multiple stacked bricks in the same direction.
 *
 * Usage:
 *
 *   const bricks = toRenko(rawCandles, 50);
 *   chart.setData(bricks);
 *
 * Reversal behavior: to flip direction, price must move 2 * brickSize
 * from the last brick's close (one brick to cancel the current run,
 * one brick to start the new run). This matches TradingView's default.
 */
export function toRenko(candles: readonly Candle[], brickSize: number): Candle[] {
  if (!Number.isFinite(brickSize) || brickSize <= 0) {
    throw new Error(`brickSize must be a positive number, got ${brickSize}`);
  }
  if (candles.length === 0) return [];

  const out: Candle[] = [];
  // Anchor on the first candle's close — not its open — so we don't
  // emit a spurious "first brick" until price actually moves.
  let anchor = candles[0]!.c;
  let lastDirection: 1 | -1 | 0 = 0;

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    // How far has price moved from the anchor, in brickSize units?
    const delta = c.c - anchor;
    const absDelta = Math.abs(delta);
    const dir: 1 | -1 = delta >= 0 ? 1 : -1;

    // Minimum distance required to print a brick:
    //   same direction as last → 1 brick
    //   opposite direction      → 2 bricks (reversal threshold)
    const required =
      lastDirection === 0 || dir === lastDirection ? brickSize : brickSize * 2;

    if (absDelta < required) continue;

    // Number of bricks to print in this direction.
    let bricks = Math.floor(absDelta / brickSize);
    // On reversal the first brick is absorbed by crossing back, so we
    // emit bricks starting from `anchor ± brickSize`.
    let startFrom = anchor;
    if (dir !== lastDirection && lastDirection !== 0) {
      // Skip one brick to absorb the reversal — leaves N-1 bricks in
      // the new direction if the move was exactly 2*brickSize.
      bricks = bricks - 1;
      if (bricks <= 0) continue;
    }

    for (let b = 0; b < bricks; b++) {
      const open = startFrom;
      const close = startFrom + dir * brickSize;
      out.push({
        o: open,
        c: close,
        h: Math.max(open, close),
        l: Math.min(open, close),
        v: 0,
        t: c.t,
      });
      startFrom = close;
    }
    anchor = startFrom;
    lastDirection = dir;
  }

  return out;
}
