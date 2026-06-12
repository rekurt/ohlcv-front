import type { CandleView } from '../types';
import type { Primitive } from '../primitives/Primitive';
import { VolumeProfilePrimitive, type VolumeProfileOptions } from './VolumeProfilePrimitive';

/**
 * Minimal host surface the controller needs. Both {@link OHLCVChart} and
 * {@link ChartEngine} satisfy it structurally — `visibleCandleView` is the thin
 * getter both expose — so the profile module depends on neither concrete class
 * and tree-shakes cleanly out of the base bundle. Typed structurally (rather
 * than importing `OHLCVChart`) so a host doing `import { VolumeProfileController }`
 * pulls nothing heavy in.
 */
export interface VolumeProfileHost {
  attachPrimitive(primitive: Primitive): void;
  detachPrimitive(id: string): boolean;
  /** Zero-copy view of the candles in the current visible window, or null. */
  visibleCandleView(): CandleView | null;
  /** Optional explicit repaint hook (used by {@link VolumeProfileController.update}). */
  requestRender?(): void;
  render?(): void;
}

/**
 * C4 public entry point. Overlays a horizontal {@link VolumeProfilePrimitive}
 * (volume binned by price over the visible window) on a chart through the host's
 * primitive framework. Constructed **explicitly** by the host
 * (`new VolumeProfileController(chart)`), which is exactly why volume profile
 * adds nothing to the base bundle: the base chart never references this class.
 *
 * Usage:
 * ```ts
 * import { VolumeProfileController } from '@rekurt/openkline-core';
 * const vp = new VolumeProfileController(chart);
 * vp.show({ bins: 30, side: 'right' });
 * // ... user pans/zooms; the profile recomputes from the visible window ...
 * vp.update();          // repaint after external data changes
 * vp.hide();
 * ```
 *
 * The primitive reads the visible window live via `host.visibleCandleView()`,
 * so panning/zooming reshapes the profile automatically on the chart's own
 * render cycle — `update()` is only needed to force a repaint after data
 * arrives without user interaction.
 */
export class VolumeProfileController {
  private _host: VolumeProfileHost;
  private _primitive: VolumeProfilePrimitive | null = null;

  constructor(host: VolumeProfileHost) {
    this._host = host;
  }

  /**
   * Show the volume profile (idempotent). On first call it attaches a fresh
   * primitive; a repeat call re-applies `opts` to the existing one and
   * repaints instead of stacking duplicates. The primitive pulls the visible
   * window through a closure on the host, so it tracks pan/zoom for free.
   */
  show(opts?: VolumeProfileOptions): void {
    if (this._primitive) {
      if (opts) this._primitive.setOptions(opts);
      this._requestRender();
      return;
    }
    this._primitive = new VolumeProfilePrimitive(() => this._host.visibleCandleView(), opts);
    this._host.attachPrimitive(this._primitive);
  }

  /** Hide the profile and detach its primitive. Returns true if one was shown. */
  hide(): boolean {
    if (!this._primitive) return false;
    this._host.detachPrimitive(this._primitive.id);
    this._primitive = null;
    return true;
  }

  /** True while the profile is attached. */
  get visible(): boolean {
    return this._primitive !== null;
  }

  /**
   * Update styling/binning of an already-shown profile in place and repaint.
   * No-op when hidden. Cheaper than hide+show — reuses the attached primitive.
   */
  setOptions(opts: VolumeProfileOptions): void {
    if (!this._primitive) return;
    this._primitive.setOptions(opts);
    this._requestRender();
  }

  /**
   * Force a repaint of the profile from the current visible window. Use after
   * the chart's data changes without a pan/zoom (which would repaint anyway).
   * No-op when hidden.
   */
  update(): void {
    if (!this._primitive) return;
    this._requestRender();
  }

  /** The attached primitive, or null when hidden (for advanced read access). */
  get primitive(): VolumeProfilePrimitive | null {
    return this._primitive;
  }

  private _requestRender(): void {
    if (this._host.requestRender) this._host.requestRender();
    else this._host.render?.();
  }
}
