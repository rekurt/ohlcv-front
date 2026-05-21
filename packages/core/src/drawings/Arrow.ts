import { Drawing, type AnchorPoint } from './Drawing';
import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';

/**
 * Arrow — a line segment from A to B with a filled triangular
 * arrowhead at B. Useful for callouts and entry/exit markers.
 *
 * The arrowhead is rendered in screen space at the tip; its size
 * is a constant `ARROW_HEAD_PX` so the head doesn't shrink with
 * deep zoom (where the underlying line would otherwise collapse).
 */
export class Arrow extends Drawing {
  static readonly KIND = 'arrow';
  static readonly HEAD_PX = 10;
  static readonly HEAD_HALF_WIDTH_PX = 5;

  get kind(): string {
    return Arrow.KIND;
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
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    const ux = dx / len;
    const uy = dy / len;

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

    // Shaft — stop short of the tip so the arrowhead doesn't get
    // doubled by the line poking through it.
    const shaftEndX = x2 - ux * Arrow.HEAD_PX * 0.6;
    const shaftEndY = y2 - uy * Arrow.HEAD_PX * 0.6;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(shaftEndX, shaftEndY);
    ctx.stroke();

    // Arrowhead — triangle with apex at (x2, y2), base perpendicular
    // to the shaft direction.
    const baseX = x2 - ux * Arrow.HEAD_PX;
    const baseY = y2 - uy * Arrow.HEAD_PX;
    // Perpendicular vector for the base width.
    const px = -uy;
    const py = ux;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(baseX + px * Arrow.HEAD_HALF_WIDTH_PX, baseY + py * Arrow.HEAD_HALF_WIDTH_PX);
    ctx.lineTo(baseX - px * Arrow.HEAD_HALF_WIDTH_PX, baseY - py * Arrow.HEAD_HALF_WIDTH_PX);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}
