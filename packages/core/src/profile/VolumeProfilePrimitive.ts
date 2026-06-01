import type { ChartLayout, ThemeColors, CandleView } from '../types';
import type { Viewport } from '../interaction/Viewport';
import type { Primitive, PrimitiveZOrder } from '../primitives/Primitive';
import { clipToChart } from '../primitives/Primitive';
import { computeVolumeProfile, type VolumeProfile } from './computeVolumeProfile';

/** Which chart edge the horizontal volume bars grow from. */
export type VolumeProfileSide = 'left' | 'right';

/** Per-tier fill colors for the profile bars. */
export interface VolumeProfileColors {
  /** Bars outside the value area. */
  bar?: string;
  /** Bars inside the value area (excluding the POC bar). */
  valueArea?: string;
  /** The single Point-of-Control bar. */
  poc?: string;
}

/** Construction / styling options for {@link VolumeProfilePrimitive}. */
export interface VolumeProfileOptions {
  /** Number of equal price bins across the visible price range. Default 24. */
  bins?: number;
  /** Edge the bars anchor to and grow from. Default `'right'`. */
  side?: VolumeProfileSide;
  /**
   * Fraction of the chart width the longest (POC) bar may occupy, in `(0, 1]`.
   * Default 0.30, so the profile is a readable sidebar rather than covering
   * the price action.
   */
  widthRatio?: number;
  /** Fraction of `totalVolume` the value area must cover, in `(0, 1]`. Default 0.70. */
  valueAreaPct?: number;
  /** Tier colors. Unset tiers fall back to theme-derived defaults. */
  colors?: VolumeProfileColors;
}

/**
 * A `'bottom'` z-tier {@link Primitive} that paints a horizontal Volume Profile
 * of the visible window: volume binned by price (see {@link computeVolumeProfile})
 * drawn as horizontal bars anchored to one chart edge, bar length proportional
 * to `volume / maxVolume`. POC and value-area bars get distinct fills; the bars
 * sit BEHIND the grid and series (semi-transparent) so they read as a backdrop.
 *
 * The primitive owns no data — it pulls the visible candles each frame through
 * a `getView` closure (the controller wires this to `engine.visibleCandleView()`),
 * so it always reflects the current pan/zoom without importing the buffer. The
 * price range comes from `viewport.priceMin/priceMax`, and each bin's mid-price
 * maps to Y via `viewport.priceToY` — inheriting price-scale-mode correctness.
 * Self-clips to the chart area. Stable id `volume-profile`.
 */
export class VolumeProfilePrimitive implements Primitive {
  readonly id = 'volume-profile';
  zOrder: PrimitiveZOrder = 'bottom';

  private _getView: () => CandleView | null;
  private _opts: Required<Omit<VolumeProfileOptions, 'colors'>> & { colors: VolumeProfileColors };

  constructor(getView: () => CandleView | null, opts?: VolumeProfileOptions) {
    this._getView = getView;
    this._opts = {
      bins: opts?.bins !== undefined && Number.isFinite(opts.bins) ? Math.max(1, Math.floor(opts.bins)) : 24,
      side: opts?.side ?? 'right',
      widthRatio: clamp01Exclusive(opts?.widthRatio, 0.3),
      valueAreaPct: clamp01Exclusive(opts?.valueAreaPct, 0.7),
      colors: opts?.colors ?? {},
    };
  }

  /** Merge new options in place (e.g. switch side, recolor) without re-attaching. */
  setOptions(opts: VolumeProfileOptions): void {
    if (opts.bins !== undefined && Number.isFinite(opts.bins)) this._opts.bins = Math.max(1, Math.floor(opts.bins));
    if (opts.side !== undefined) this._opts.side = opts.side;
    if (opts.widthRatio !== undefined) this._opts.widthRatio = clamp01Exclusive(opts.widthRatio, this._opts.widthRatio);
    if (opts.valueAreaPct !== undefined) {
      this._opts.valueAreaPct = clamp01Exclusive(opts.valueAreaPct, this._opts.valueAreaPct);
    }
    if (opts.colors !== undefined) this._opts.colors = { ...this._opts.colors, ...opts.colors };
  }

  /** The most recent options (read-only snapshot). */
  get options(): Readonly<VolumeProfileOptions> {
    return this._opts;
  }

  /**
   * Compute the profile that would be drawn for the current visible window —
   * exposed for hosts that want the POC / value-area numbers (e.g. to label
   * them) without scraping the canvas. Returns `null` when there's nothing to
   * profile (no view, empty window, or a degenerate price range).
   */
  computeFor(viewport: Viewport): VolumeProfile | null {
    const view = this._getView();
    if (!view || view.length === 0) return null;
    const priceMin = viewport.priceMin;
    const priceMax = viewport.priceMax;
    if (!Number.isFinite(priceMin) || !Number.isFinite(priceMax) || priceMin >= priceMax) return null;
    return computeVolumeProfile(view, this._opts.bins, priceMin, priceMax, {
      valueAreaPct: this._opts.valueAreaPct,
    });
  }

  draw(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    theme: ThemeColors,
  ): void {
    const profile = this.computeFor(viewport);
    if (!profile || profile.totalVolume <= 0) return;

    // Longest bar maps to widthRatio of the chart width.
    let maxVolume = 0;
    for (const bin of profile.bins) if (bin.volume > maxVolume) maxVolume = bin.volume;
    if (maxVolume <= 0) return;

    const chartWidth = layout.chartRight - layout.chartLeft;
    if (chartWidth <= 0) return;
    const maxBarWidth = chartWidth * this._opts.widthRatio;
    const side = this._opts.side;

    const barColor = this._opts.colors.bar ?? withAlpha(theme.bullVolume, 0.28);
    const vaColor = this._opts.colors.valueArea ?? withAlpha(theme.bearVolume, 0.38);
    const pocColor = this._opts.colors.poc ?? withAlpha(theme.priceLine, 0.55);

    // Value-area bin index span (inclusive), recovered from its price extent so
    // we don't recompute. Bins are ordered low→high, value area is contiguous.
    const { vaLowIdx, vaHighIdx } = valueAreaIndices(profile);

    ctx.save();
    clipToChart(ctx, layout);

    for (let b = 0; b < profile.bins.length; b++) {
      const bin = profile.bins[b]!;
      if (bin.volume <= 0) continue;

      // Bar vertical extent = the bin's price band projected through the
      // (possibly log/percentage) price axis. priceToY is monotic decreasing,
      // so the high edge is the smaller Y.
      const yHigh = viewport.priceToY(bin.priceHigh);
      const yLow = viewport.priceToY(bin.priceLow);
      const top = Math.min(yHigh, yLow);
      const bottom = Math.max(yHigh, yLow);
      // Leave a 1px hairline gutter between bars so adjacent bins read apart,
      // but never collapse a thin bin to nothing.
      const rawH = bottom - top;
      const h = rawH > 2 ? rawH - 1 : Math.max(rawH, 1);

      const w = maxBarWidth * (bin.volume / maxVolume);
      if (w <= 0) continue;
      const x = side === 'right' ? layout.chartRight - w : layout.chartLeft;

      ctx.fillStyle = b === profile.pocIndex ? pocColor : b >= vaLowIdx && b <= vaHighIdx ? vaColor : barColor;
      ctx.fillRect(x, top, w, h);
    }

    ctx.restore();
  }
}

/**
 * Recover the inclusive `[vaLowIdx, vaHighIdx]` bin span of the value area from
 * its price extent. The value area is a contiguous run of bins, so we find the
 * lowest bin whose `priceLow` is at/above `valueAreaLow` and the highest whose
 * `priceHigh` is at/below `valueAreaHigh`. Falls back to the POC-only span if
 * the extent can't be matched (shouldn't happen for a well-formed profile).
 */
function valueAreaIndices(profile: VolumeProfile): { vaLowIdx: number; vaHighIdx: number } {
  const bins = profile.bins;
  const eps = 1e-9;
  let vaLowIdx = profile.pocIndex >= 0 ? profile.pocIndex : 0;
  let vaHighIdx = vaLowIdx;
  let found = false;
  for (let b = 0; b < bins.length; b++) {
    const inside =
      bins[b]!.priceHigh > profile.valueAreaLow + eps && bins[b]!.priceLow < profile.valueAreaHigh - eps;
    if (inside) {
      if (!found) {
        vaLowIdx = b;
        found = true;
      }
      vaHighIdx = b;
    }
  }
  return { vaLowIdx, vaHighIdx };
}

/**
 * Apply an alpha to a hex color (`#rgb` / `#rrggbb`) or pass through an
 * already-alpha color (rgba/named). Used for the semi-transparent default
 * fills so the profile reads as a backdrop behind the series. Kept local so
 * the profile module pulls nothing extra into a host that imports it.
 */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    let r: number;
    let g: number;
    let b: number;
    if (color.length === 4) {
      r = parseInt(color[1]! + color[1]!, 16);
      g = parseInt(color[2]! + color[2]!, 16);
      b = parseInt(color[3]! + color[3]!, 16);
    } else if (color.length === 7) {
      r = parseInt(color.slice(1, 3), 16);
      g = parseInt(color.slice(3, 5), 16);
      b = parseInt(color.slice(5, 7), 16);
    } else {
      return color;
    }
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return color;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

/** Clamp a ratio into `(0, 1]`; fall back to `fallback` for unset/invalid. */
function clamp01Exclusive(v: number | undefined, fallback: number): number {
  if (v === undefined || !Number.isFinite(v) || v <= 0) return fallback;
  return v > 1 ? 1 : v;
}
