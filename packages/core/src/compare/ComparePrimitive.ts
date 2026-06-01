import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';
import type { Primitive, PrimitiveZOrder } from '../primitives/Primitive';
import { clipToChart } from '../primitives/Primitive';
import type { CompareSeries, CompareNormalization } from './CompareSeries';

/**
 * Shared, self-scaling Y axis for every `'percentage'` / `'indexed'` compare
 * series on a chart. Compare lines only become comparable if they share one
 * normalized scale — otherwise each would auto-fit independently and a flat
 * series would look as volatile as a wild one. The controller owns one
 * instance and hands it to every {@link ComparePrimitive}; the bounds are
 * recomputed lazily, at most once per animation frame, the first time any
 * primitive draws that frame.
 *
 * The scale is keyed on `(visible window, base, normalization-set)` indirectly
 * via a per-frame token the engine bumps — but since primitives don't get a
 * frame token, we recompute whenever the *viewport-derived visible window*
 * changes. To stay cheap and correct we just recompute on every fresh
 * `beginFrame()` call (one per attached series per paint), guarded so only the
 * first call in a paint batch does the O(points) scan.
 */
export class CompareScale {
  /** Live reference to the controller's series list (mutated in place). */
  private _series: readonly CompareSeries[];
  private _min = 0;
  private _max = 100;
  /** Identity of the last window the bounds were computed for. */
  private _key = '';

  constructor(series: readonly CompareSeries[]) {
    this._series = series;
  }

  get min(): number {
    return this._min;
  }

  get max(): number {
    return this._max;
  }

  /**
   * Ensure the shared `[min, max]` covers every normalized
   * `'percentage'`/`'indexed'` series across the visible window. Recomputes
   * only when the visible window changed since the last call (so the N
   * primitives painted in one frame share a single O(points) scan). A no-op
   * for a window with no normalized series — the previous bounds are kept.
   */
  ensure(viewport: Viewport): void {
    // Cheap identity of the current visible window + zoom. priceToY for the
    // normalized axis only depends on chartTop/Bottom (constant within a
    // frame); the *normalized values* depend on which bars are first-visible,
    // captured by startIndex + visibleCount.
    const key = `${viewport.startIndex}|${viewport.visibleCount}|${viewport.layout.chartLeft}|${viewport.layout.chartRight}`;
    if (key === this._key) return;
    this._key = key;

    let min = Infinity;
    let max = -Infinity;
    for (const s of this._series) {
      const mode = s.normalization ?? 'percentage';
      if (mode === 'price') continue; // priced series use the main axis
      const base = firstVisibleValue(s, viewport);
      if (base === null) continue;
      for (const p of s.points) {
        const x = viewport.timeToX(p.t);
        if (!Number.isFinite(x)) continue;
        if (x < viewport.layout.chartLeft || x > viewport.layout.chartRight) continue;
        const n = normalize(p.value, base, mode);
        if (!Number.isFinite(n)) continue;
        if (n < min) min = n;
        if (n > max) max = n;
      }
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) return; // keep previous
    if (min === max) {
      // Flat window: pad so the line sits mid-pane instead of dividing by zero.
      const pad = Math.abs(max) * 0.01 || 1;
      min -= pad;
      max += pad;
    }
    this._min = min;
    this._max = max;
  }

  /** Force a recompute on the next {@link ensure} (call after mutating series). */
  invalidate(): void {
    this._key = '';
  }
}

/**
 * Apply a compare normalization to a raw value given the first-visible base.
 *  - percentage → `(v / base - 1) * 100`
 *  - indexed    → `v / base * 100`
 *  - price      → `v` (unchanged)
 */
export function normalize(value: number, base: number, mode: CompareNormalization): number {
  if (mode === 'price') return value;
  if (base === 0) return NaN;
  if (mode === 'percentage') return (value / base - 1) * 100;
  return (value / base) * 100; // indexed
}

/**
 * First point of `series` whose time maps into the visible chart window, used
 * as the normalization base (its value anchors `0%` / `100`). Walks the points
 * in time order and returns the first finite value whose X lands in
 * `[chartLeft, chartRight]`. Returns null when nothing in the series is
 * visible — the primitive then draws nothing this frame.
 */
function firstVisibleValue(series: CompareSeries, viewport: Viewport): number | null {
  for (const p of series.points) {
    if (!Number.isFinite(p.value)) continue;
    const x = viewport.timeToX(p.t);
    if (!Number.isFinite(x)) continue;
    if (x < viewport.layout.chartLeft || x > viewport.layout.chartRight) continue;
    return p.value;
  }
  return null;
}

/**
 * A `'normal'` z-tier {@link Primitive} that plots one compare series as a
 * normalized line over the main chart. Self-contained: positions every point
 * by **time** (`viewport.timeToX`) so it aligns with the price series under any
 * pan/zoom and even when its own timestamps don't match the main bars, and
 * clips to the chart area (`clipToChart`). Y mapping:
 *
 *  - `'percentage'` / `'indexed'` → the shared, self-scaling {@link CompareScale}
 *    so every normalized compare line is mutually comparable, independent of
 *    the main price axis.
 *  - `'price'` → the main right price scale (`viewport.priceToY`), for the rare
 *    case the compare symbol shares the chart's price magnitude.
 *
 * Stable id `compare:<seriesId>` so the controller can detach it.
 */
export class ComparePrimitive implements Primitive {
  readonly id: string;
  readonly zOrder: PrimitiveZOrder = 'normal';
  private _series: CompareSeries;
  private _scale: CompareScale;

  constructor(series: CompareSeries, scale: CompareScale) {
    this.id = `compare:${series.id}`;
    this._series = series;
    this._scale = scale;
  }

  /** The series this primitive renders (live reference, mutated by the controller). */
  get series(): CompareSeries {
    return this._series;
  }

  /** Replace the series payload (e.g. on a data refresh) without re-attaching. */
  setSeries(series: CompareSeries): void {
    this._series = series;
    this._scale.invalidate();
  }

  draw(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    _theme: ThemeColors,
  ): void {
    const series = this._series;
    if (series.points.length === 0) return;

    const mode: CompareNormalization = series.normalization ?? 'percentage';
    const normalized = mode !== 'price';

    // Normalization base = first visible value. With nothing visible there's
    // nothing to anchor, so skip the frame.
    const base = normalized ? firstVisibleValue(series, viewport) : 0;
    if (normalized && base === null) return;

    // Refresh the shared normalized scale (once per paint batch) before mapping
    // any Y, so all compare lines this frame share one axis.
    if (normalized) this._scale.ensure(viewport);

    const yOf = (value: number): number => {
      if (!normalized) return viewport.priceToY(value);
      const n = normalize(value, base!, mode);
      return this._scaledY(n, layout);
    };

    ctx.save();
    clipToChart(ctx, layout);
    ctx.strokeStyle = series.color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();

    let pen = false;
    for (const p of series.points) {
      const value = p.value;
      if (!Number.isFinite(value)) {
        pen = false; // break the line over a gap, matching the overlay renderer
        continue;
      }
      const x = viewport.timeToX(p.t);
      const y = yOf(value);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        pen = false;
        continue;
      }
      if (!pen) {
        ctx.moveTo(x, y);
        pen = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Map a normalized value through the shared self-scaling axis to a Y pixel. */
  private _scaledY(n: number, layout: ChartLayout): number {
    const min = this._scale.min;
    const max = this._scale.max;
    const range = max - min;
    if (range === 0) return (layout.chartTop + layout.chartBottom) / 2;
    return layout.chartTop + (1 - (n - min) / range) * (layout.chartBottom - layout.chartTop);
  }
}
