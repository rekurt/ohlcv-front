import type { Primitive } from '../primitives/Primitive';
import type { CompareSeries } from './CompareSeries';
import { ComparePrimitive, CompareScale } from './ComparePrimitive';

/**
 * Minimal surface the controller needs from its host. Both {@link OHLCVChart}
 * and {@link ChartEngine} structurally satisfy it, so the compare module
 * depends on neither concrete class — keeping it independently importable and
 * tree-shakeable out of the base bundle. (Typed structurally rather than
 * importing `OHLCVChart` so this file pulls nothing heavy into a host that
 * does `import { CompareController }`.)
 */
export interface CompareHost {
  attachPrimitive(primitive: Primitive): void;
  detachPrimitive(id: string): boolean;
  /** Optional explicit repaint hook. attach/detach already repaint on the
   *  built-in hosts; this is only used for in-place series updates. */
  render?(): void;
  requestRender?(): void;
}

/**
 * C2 public entry point. Manages a set of {@link CompareSeries} overlaid on a
 * chart, materializing each as a {@link ComparePrimitive} attached through the
 * host's primitive framework. Constructed **explicitly** by the host
 * (`new CompareController(chart)`), which is precisely why compare mode adds
 * nothing to the base bundle: the base chart never references this class.
 *
 * Usage:
 * ```ts
 * import { CompareController } from '@rekurt/ohlcv-core';
 * const compare = new CompareController(chart);
 * compare.add({ id: 'ETH', color: '#8884', points, normalization: 'percentage' });
 * // ...
 * compare.remove('ETH');
 * compare.clear();
 * ```
 *
 * All `'percentage'`/`'indexed'` series share one self-scaling normalized Y
 * axis (see {@link CompareScale}) so the lines are mutually comparable.
 */
export class CompareController {
  private _host: CompareHost;
  /** Series in insertion order (the shared scale reads this live). */
  private _series: CompareSeries[] = [];
  private _scale: CompareScale;
  /** seriesId → attached primitive, for in-place updates and detach. */
  private _primitives = new Map<string, ComparePrimitive>();

  constructor(host: CompareHost) {
    this._host = host;
    this._scale = new CompareScale(this._series);
  }

  /**
   * Add (or replace, by `id`) a compare series and attach its primitive. A
   * duplicate id swaps the series payload in place — the old primitive is
   * detached first so the chart never carries two lines for one symbol. The
   * host repaints via `attachPrimitive`.
   */
  add(series: CompareSeries): void {
    const existingIdx = this._series.findIndex((s) => s.id === series.id);
    if (existingIdx !== -1) {
      // Replace in place: detach old primitive, swap the series entry.
      this._host.detachPrimitive(`compare:${series.id}`);
      this._primitives.delete(series.id);
      this._series[existingIdx] = series;
    } else {
      this._series.push(series);
    }
    this._scale.invalidate();
    const primitive = new ComparePrimitive(series, this._scale);
    this._primitives.set(series.id, primitive);
    this._host.attachPrimitive(primitive);
  }

  /**
   * Remove a compare series by id and detach its primitive. Returns true if a
   * series with that id existed.
   */
  remove(id: string): boolean {
    const idx = this._series.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    this._series.splice(idx, 1);
    this._primitives.delete(id);
    this._scale.invalidate();
    this._host.detachPrimitive(`compare:${id}`);
    return true;
  }

  /** The compare series currently overlaid, in insertion order (a copy). */
  list(): CompareSeries[] {
    return this._series.slice();
  }

  /**
   * Update an existing series' points/color/normalization in place (matched by
   * `id`) and repaint. Returns true if the series existed. Cheaper than
   * remove+add — it reuses the attached primitive instead of detaching it.
   */
  update(series: CompareSeries): boolean {
    const idx = this._series.findIndex((s) => s.id === series.id);
    if (idx === -1) return false;
    this._series[idx] = series;
    this._primitives.get(series.id)?.setSeries(series);
    this._scale.invalidate();
    this._requestRender();
    return true;
  }

  /** Remove every compare series and detach all primitives. */
  clear(): void {
    for (const s of this._series) {
      this._host.detachPrimitive(`compare:${s.id}`);
    }
    this._series.length = 0;
    this._primitives.clear();
    this._scale.invalidate();
  }

  private _requestRender(): void {
    if (this._host.requestRender) this._host.requestRender();
    else this._host.render?.();
  }
}
