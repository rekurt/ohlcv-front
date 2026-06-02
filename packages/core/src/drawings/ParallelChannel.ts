import { Drawing, type AnchorPoint } from './Drawing';
import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';
import { DRAWING_HIT_TOLERANCE_PX } from '../constants';
import { colorWithAlpha, distanceToSegment } from './geometry';

/**
 * Parallel (bounded) channel — three anchor points:
 *   A, B → the base line segment (defines slope and extent)
 *   C    → a point on the parallel boundary (defines the offset)
 *
 * Unlike {@link Channel}, which extends its boundaries across the whole
 * visible window like an equidistant channel, ParallelChannel draws the
 * two boundaries as finite segments spanning the base anchors' x-range,
 * with a translucent fill between them. Useful for marking a measured
 * move bounded to a specific window.
 *
 * The parallel boundary is offset from the base by the vertical (price)
 * distance between C and the base line at C's index, so the two lines
 * stay parallel under any price re-scale.
 */
export class ParallelChannel extends Drawing {
  static readonly KIND = 'parallelchannel';

  get kind(): string {
    return ParallelChannel.KIND;
  }
  get requiredPoints(): number {
    return 3;
  }

  /** Price offset of the parallel boundary, in price units, or null if degenerate. */
  private _offset(a: AnchorPoint, b: AnchorPoint, c: AnchorPoint): number | null {
    if (b.index === a.index) return null;
    const slope = (b.price - a.price) / (b.index - a.index);
    const priceBaseAtC = a.price + slope * (c.index - a.index);
    return c.price - priceBaseAtC;
  }

  override render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    theme: ThemeColors,
  ): void {
    if (this.points.length < 3) return;
    const [a, b, c] = this.points as [AnchorPoint, AnchorPoint, AnchorPoint];
    const offset = this._offset(a, b, c);
    if (offset === null) return;

    const xa = viewport.indexToX(a.index);
    const ya = viewport.priceToY(a.price);
    const xb = viewport.indexToX(b.index);
    const yb = viewport.priceToY(b.price);
    // Parallel boundary endpoints share the base x-range, shifted by offset.
    const ya2 = viewport.priceToY(a.price + offset);
    const yb2 = viewport.priceToY(b.price + offset);

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

    // Translucent fill between the two segments.
    ctx.fillStyle = colorWithAlpha(color, 0.08);
    ctx.beginPath();
    ctx.moveTo(xa, ya);
    ctx.lineTo(xb, yb);
    ctx.lineTo(xb, yb2);
    ctx.lineTo(xa, ya2);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xa, ya);
    ctx.lineTo(xb, yb);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(xa, ya2);
    ctx.lineTo(xb, yb2);
    ctx.stroke();

    ctx.restore();
  }

  override hitTest(
    px: number,
    py: number,
    layout: ChartLayout,
    viewport: Viewport,
    tolerance: number = DRAWING_HIT_TOLERANCE_PX,
  ): boolean {
    if (this.points.length < 3) return false;
    if (px < layout.chartLeft || px > layout.chartRight) return false;
    if (py < layout.chartTop || py > layout.chartBottom) return false;
    const [a, b, c] = this.points as [AnchorPoint, AnchorPoint, AnchorPoint];
    const offset = this._offset(a, b, c);
    if (offset === null) return false;
    const xa = viewport.indexToX(a.index);
    const ya = viewport.priceToY(a.price);
    const xb = viewport.indexToX(b.index);
    const yb = viewport.priceToY(b.price);
    const ya2 = viewport.priceToY(a.price + offset);
    const yb2 = viewport.priceToY(b.price + offset);
    const d1 = distanceToSegment(px, py, xa, ya, xb, yb);
    const d2 = distanceToSegment(px, py, xa, ya2, xb, yb2);
    return Math.min(d1, d2) <= tolerance;
  }
}
