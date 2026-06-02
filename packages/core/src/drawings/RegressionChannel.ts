import { Drawing, type AnchorPoint } from './Drawing';
import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';
import { DRAWING_HIT_TOLERANCE_PX } from '../constants';
import { colorWithAlpha, distanceToSegment, linearRegression, type LinearFit } from './geometry';

/**
 * Pulls the `close` series for the inclusive buffer-index span
 * `[startIndex, endIndex]`. Returned array is ordered oldest→newest and
 * indexed so `result[i]` is the close at buffer index `startIndex + i`.
 * The host wires this in {@link OHLCVChart.startDrawing} so the drawing
 * can sample candle data without the render path ever touching the
 * buffer (which the `Drawing.render` signature deliberately omits).
 */
export type CloseSampler = (startIndex: number, endIndex: number) => number[];

/**
 * Linear-regression channel — two anchor points delimiting an index
 * span. A least-squares line is fitted to the `close` values inside the
 * span (the central line); parallel ±k·σ boundaries (k = 2 by default,
 * the conventional regression-channel width) bracket it.
 *
 * Data access: `Drawing.render(ctx, layout, viewport, theme)` has no
 * candle buffer by design (anchors are the single source of truth for
 * every other drawing). Rather than widen that signature, the channel
 * keeps its own `samples` array — the closes of its span — populated
 * once via a {@link CloseSampler} the host attaches at creation, or via
 * {@link setSamples}/snapshot restore. The samples persist in the
 * drawing snapshot (`data`), so a reloaded channel reproduces the exact
 * same fit with no buffer present.
 *
 * Anchors carry only the span (`index`); their `price` is used solely as
 * a fallback center line when no samples are available yet (e.g. a span
 * entirely outside the loaded buffer), so the drawing degrades to a
 * plain segment instead of vanishing.
 */
export class RegressionChannel extends Drawing {
  static readonly KIND = 'regression';
  /** Band half-width in standard deviations. */
  static readonly K = 2;

  /** Closes of the span, oldest→newest; `samples[0]` is at `spanStart`. */
  private _samples: number[] = [];
  /** Buffer index of `samples[0]`, or null when unsampled. */
  private _sampleStart: number | null = null;
  /** Host-provided data source; consulted lazily on first complete render. */
  private _sampler: CloseSampler | null = null;

  get kind(): string {
    return RegressionChannel.KIND;
  }
  get requiredPoints(): number {
    return 2;
  }

  /** Attach the candle-data source. Called by the host at creation time. */
  setSampler(sampler: CloseSampler | null): void {
    this._sampler = sampler;
  }

  /**
   * Provide the close samples directly. `start` is the buffer index of
   * `samples[0]`. Replaces any previously sampled/cached data.
   */
  setSamples(samples: number[], start: number): void {
    this._samples = samples.slice();
    this._sampleStart = start;
  }

  /** True once a non-empty close series has been captured. */
  get hasSamples(): boolean {
    return this._samples.length > 0;
  }

  protected override snapshotData(): number[] | undefined {
    return this._samples.length > 0 ? this._samples : undefined;
  }

  override restoreData(data: number[] | undefined): void {
    if (data === undefined || data.length === 0) return;
    this._samples = data.slice();
    // The span start is the lower of the two anchor indices (anchors are
    // restored before data by the snapshot factory).
    this._sampleStart = this._spanStart();
  }

  /** Lower anchor index, rounded to an integer buffer position. */
  private _spanStart(): number {
    if (this.points.length < 2) return 0;
    const [a, b] = this.points as [AnchorPoint, AnchorPoint];
    return Math.round(Math.min(a.index, b.index));
  }

  /**
   * Ensure `samples` is populated, sampling from the host source on
   * first use. No-op when already sampled or no source is attached.
   */
  private _ensureSamples(): void {
    if (this._samples.length > 0) return;
    if (!this._sampler || this.points.length < 2) return;
    const [a, b] = this.points as [AnchorPoint, AnchorPoint];
    const start = Math.round(Math.min(a.index, b.index));
    const end = Math.round(Math.max(a.index, b.index));
    const closes = this._sampler(start, end);
    if (closes.length > 0) {
      this._samples = closes.slice();
      this._sampleStart = start;
    }
  }

  /**
   * Compute the fitted line in price-vs-index space. Returns null when
   * the drawing is incomplete; falls back to the anchor segment when no
   * samples are available.
   */
  private _fit(): { center: LinearFit; sigma: number; sampleStart: number } | null {
    if (this.points.length < 2) return null;
    this._ensureSamples();
    const [a, b] = this.points as [AnchorPoint, AnchorPoint];
    if (this._samples.length >= 2 && this._sampleStart !== null) {
      const fit = linearRegression(this._samples, this._sampleStart);
      return { center: fit, sigma: fit.sigma, sampleStart: this._sampleStart };
    }
    // Fallback: a zero-band line through the two anchors (no samples).
    if (b.index === a.index) return null;
    const slope = (b.price - a.price) / (b.index - a.index);
    const start = Math.round(Math.min(a.index, b.index));
    const interceptAtStart = a.price + slope * (start - a.index);
    return {
      center: { slope, intercept: interceptAtStart, sigma: 0, x0: start },
      sigma: 0,
      sampleStart: start,
    };
  }

  /** Price on the center line at a buffer index. */
  private _centerPriceAt(center: LinearFit, index: number): number {
    return center.intercept + center.slope * (index - center.x0);
  }

  override render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    theme: ThemeColors,
  ): void {
    const fit = this._fit();
    if (fit === null) return;
    const { center, sigma } = fit;
    const [a, b] = this.points as [AnchorPoint, AnchorPoint];

    const i1 = Math.min(a.index, b.index);
    const i2 = Math.max(a.index, b.index);
    const x1 = viewport.indexToX(i1);
    const x2 = viewport.indexToX(i2);
    const cp1 = this._centerPriceAt(center, i1);
    const cp2 = this._centerPriceAt(center, i2);
    const band = RegressionChannel.K * sigma;

    const yc1 = viewport.priceToY(cp1);
    const yc2 = viewport.priceToY(cp2);
    const yu1 = viewport.priceToY(cp1 + band);
    const yu2 = viewport.priceToY(cp2 + band);
    const yl1 = viewport.priceToY(cp1 - band);
    const yl2 = viewport.priceToY(cp2 - band);

    const color = this.color ?? theme.text;

    ctx.save();
    ctx.beginPath();
    ctx.rect(
      layout.chartLeft,
      layout.chartTop,
      layout.chartRight - layout.chartLeft,
      layout.chartBottom - layout.chartTop,
    );
    ctx.clip();

    if (band > 0) {
      // Fill between the ±k·σ boundaries.
      ctx.fillStyle = colorWithAlpha(color, 0.07);
      ctx.beginPath();
      ctx.moveTo(x1, yu1);
      ctx.lineTo(x2, yu2);
      ctx.lineTo(x2, yl2);
      ctx.lineTo(x1, yl1);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = color;
    // Center line solid, bands dashed.
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, yc1);
    ctx.lineTo(x2, yc2);
    ctx.stroke();

    if (band > 0) {
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x1, yu1);
      ctx.lineTo(x2, yu2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x1, yl1);
      ctx.lineTo(x2, yl2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  override hitTest(
    px: number,
    py: number,
    layout: ChartLayout,
    viewport: Viewport,
    tolerance: number = DRAWING_HIT_TOLERANCE_PX,
  ): boolean {
    if (px < layout.chartLeft || px > layout.chartRight) return false;
    if (py < layout.chartTop || py > layout.chartBottom) return false;
    const fit = this._fit();
    if (fit === null) return false;
    const { center, sigma } = fit;
    const [a, b] = this.points as [AnchorPoint, AnchorPoint];
    const i1 = Math.min(a.index, b.index);
    const i2 = Math.max(a.index, b.index);
    const x1 = viewport.indexToX(i1);
    const x2 = viewport.indexToX(i2);
    const cp1 = this._centerPriceAt(center, i1);
    const cp2 = this._centerPriceAt(center, i2);
    const band = RegressionChannel.K * sigma;
    const yc1 = viewport.priceToY(cp1);
    const yc2 = viewport.priceToY(cp2);
    let min = distanceToSegment(px, py, x1, yc1, x2, yc2);
    if (band > 0) {
      const yu1 = viewport.priceToY(cp1 + band);
      const yu2 = viewport.priceToY(cp2 + band);
      const yl1 = viewport.priceToY(cp1 - band);
      const yl2 = viewport.priceToY(cp2 - band);
      min = Math.min(
        min,
        distanceToSegment(px, py, x1, yu1, x2, yu2),
        distanceToSegment(px, py, x1, yl1, x2, yl2),
      );
    }
    return min <= tolerance;
  }
}
