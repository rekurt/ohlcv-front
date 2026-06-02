/**
 * C2 — Compare mode: overlaying one or more foreign symbols on the main chart
 * with a normalization that makes series of wildly different price magnitudes
 * (e.g. BTC at 60,000 vs. an altcoin at 0.5) visually comparable.
 *
 * This module is **optional and self-contained** — it is never statically
 * imported by `OHLCVChart` / `ChartEngine`, so it tree-shakes to zero in the
 * base bundle. A host opts in by constructing a {@link CompareController}
 * explicitly (see ./CompareController), which renders each series through the
 * existing Primitive framework (`chart.attachPrimitive`).
 */

/**
 * How a compare series' raw values are mapped before plotting:
 *  - `'percentage'` — percent change vs. the first **visible** value:
 *    `(v / base - 1) * 100`. The base is `0%`, so all series start at the same
 *    height on the left edge and diverge by relative performance.
 *  - `'indexed'` — the first **visible** value is pinned to `100`:
 *    `v / base * 100`. Same shape as `'percentage'` shifted up by 100.
 *  - `'price'` — no normalization; the raw value is plotted. Useful only when
 *    the compare symbol shares the main series' price magnitude.
 *
 * `'percentage'` and `'indexed'` share one internal, self-scaling Y axis across
 * every compare series (see {@link ComparePrimitive}) so the lines are directly
 * comparable regardless of the main price axis. `'price'` projects through the
 * main right price scale (`viewport.priceToY`).
 */
export type CompareNormalization = 'percentage' | 'indexed' | 'price';

/**
 * One symbol overlaid on the chart in compare mode.
 *
 * `points` must be sorted ascending by time (`t`, Unix seconds, matching the
 * main series). `value` is the symbol's close price at that time. The series'
 * timestamps need NOT line up with the main chart's bars — they are aligned to
 * the X axis by time (`viewport.timeToX`), interpolating between main-series
 * bars as needed.
 */
export interface CompareSeries {
  /** Stable identifier (used to build the primitive id and for remove/list). */
  id: string;
  /** Optional human label (e.g. the symbol name). Not drawn by the primitive. */
  label?: string;
  /** Line color (any CSS color string). */
  color: string;
  /** Close-price points, ascending by time. */
  points: { t: number; value: number }[];
  /** Normalization mode. Defaults to `'percentage'`. */
  normalization?: CompareNormalization;
}
