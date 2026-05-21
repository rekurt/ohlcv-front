import { Drawing, type AnchorPoint } from './Drawing';
import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';

/**
 * A semi-infinite line starting at the first anchor, passing through
 * the second, and extending to the right edge of the chart area. The
 * direction is computed from the two anchors in screen space, so the
 * ray rotates correctly when the price axis re-scales.
 */
export class Ray extends Drawing {
  static readonly KIND = 'ray';

  get kind(): string {
    return Ray.KIND;
  }
  get requiredPoints(): number {
    return 2;
  }

  override render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    theme: ThemeColors,
  ): void {
    if (this.points.length < 2) return;
    const [a, b] = this.points as [AnchorPoint, AnchorPoint];

    const x1 = viewport.indexToX(a.index);
    const y1 = viewport.priceToY(a.price);
    const x2 = viewport.indexToX(b.index);
    const y2 = viewport.priceToY(b.price);

    const dx = x2 - x1;
    const dy = y2 - y1;

    // Degenerate ray (both points coincide) — render nothing rather
    // than a point.
    if (dx === 0 && dy === 0) return;

    // Project to the right edge of the chart area. If the ray is
    // vertical (dx == 0) we cap at the top/bottom instead.
    let endX = layout.chartRight;
    let endY = y2;
    if (dx !== 0) {
      const slope = dy / dx;
      if (dx > 0) {
        endX = layout.chartRight;
      } else {
        endX = layout.chartLeft;
      }
      endY = y1 + slope * (endX - x1);
    } else {
      endX = x1;
      endY = dy > 0 ? layout.chartBottom : layout.chartTop;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(
      layout.chartLeft,
      layout.chartTop,
      layout.chartRight - layout.chartLeft,
      layout.chartBottom - layout.chartTop,
    );
    ctx.clip();

    ctx.strokeStyle = this.color ?? theme.text;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    ctx.restore();
  }
}
