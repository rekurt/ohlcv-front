import type { Candle } from '../types';
import type { Viewport } from '../interaction/Viewport';

/**
 * Where a marker sits relative to its candle:
 * - `above` — just above the candle's high (e.g. a sell/exit flag)
 * - `below` — just below the candle's low (e.g. a buy/entry flag)
 * - `inline` — at an explicit `price` (defaults to the candle close)
 */
export type MarkerPosition = 'above' | 'below' | 'inline';

/** Glyph drawn for a marker. */
export type MarkerShape = 'arrowUp' | 'arrowDown' | 'circle' | 'square' | 'flag';

/**
 * A point annotation pinned to a single candle by its timestamp. Unlike
 * drawings (anchored by buffer index), markers anchor by `time` so they
 * survive history prepends and `maxCandles` eviction without any index
 * bookkeeping — the renderer resolves the candle by time each frame.
 *
 * `Marker` is a plain JSON-safe object; the array IS its serialized form,
 * so there is no separate snapshot type.
 */
export interface Marker {
  /** Stable id (for removal / dedupe). */
  id: string;
  /** Unix-seconds timestamp of the candle this marker annotates. */
  time: number;
  /** Vertical placement relative to the candle. Default `'above'`. */
  position?: MarkerPosition;
  /** Glyph to draw. Default `'circle'`. */
  shape?: MarkerShape;
  /** CSS color. Defaults to the theme text color. */
  color?: string;
  /** Optional short label drawn next to the glyph. */
  text?: string;
  /** Price used when `position === 'inline'`. Defaults to the candle close. */
  price?: number;
  /** Glyph size in px. Defaults to `MARKER_SIZE`. */
  size?: number;
}

/**
 * Y pixel coordinate for a marker given its candle. Pure helper, exported
 * for testing and for consumers building custom marker renderers.
 *
 * @param gap extra spacing (px) between the candle high/low and an
 *   above/below glyph (so the glyph clears the wick).
 */
export function markerY(
  marker: Marker,
  candle: Candle,
  viewport: Viewport,
  gap: number,
  size: number,
): number {
  const position = marker.position ?? 'above';
  if (position === 'inline') {
    return viewport.priceToY(marker.price ?? candle.c);
  }
  if (position === 'below') {
    return viewport.priceToY(candle.l) + gap + size;
  }
  // above
  return viewport.priceToY(candle.h) - gap - size;
}
