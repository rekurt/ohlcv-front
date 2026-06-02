import { Drawing, type AnchorPoint } from './Drawing';
import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';
import { DRAWING_HIT_TOLERANCE_PX } from '../constants';
import { distanceToSegment } from './geometry';

/**
 * Fibonacci fan — two anchor points A→B defining a base trend. Rays
 * radiate from A through fib-divided levels of the A→B price range,
 * projected at B's index, and extend to the right chart edge.
 *
 * For each ratio r, the ray passes from A through the point at B's index
 * whose price is `A.price + r·(B.price − A.price)`. The conventional
 * intermediate ratios (0.382 / 0.5 / 0.618) are used; the 0 and 1 rays
 * coincide with the horizontal through A and the A→B trend line itself,
 * which is also drawn for reference.
 */
export class FibFan extends Drawing {
  static readonly KIND = 'fibfan';
  static readonly LEVELS = [0.382, 0.5, 0.618];

  get kind(): string {
    return FibFan.KIND;
  }
  get requiredPoints(): number {
    return 2;
  }

  /** Extend a ray from (ax, ay) through (tx, ty) to the chart edge. */
  private _toEdge(
    ax: number,
    ay: number,
    tx: number,
    ty: number,
    layout: ChartLayout,
  ): { x: number; y: number } {
    const dx = tx - ax;
    const dy = ty - ay;
    if (dx === 0 && dy === 0) return { x: tx, y: ty };
    if (dx === 0) {
      return { x: ax, y: dy > 0 ? layout.chartBottom : layout.chartTop };
    }
    const endX = dx > 0 ? layout.chartRight : layout.chartLeft;
    const endY = ay + (dy / dx) * (endX - ax);
    return { x: endX, y: endY };
  }

  override render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    theme: ThemeColors,
  ): void {
    if (this.points.length < 2) return;
    const [a, b] = this.points as [AnchorPoint, AnchorPoint];
    const ax = viewport.indexToX(a.index);
    const ay = viewport.priceToY(a.price);
    const bx = viewport.indexToX(b.index);
    const by = viewport.priceToY(b.price);
    if (ax === bx && ay === by) return;

    const priceRange = b.price - a.price;
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

    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    // Reference base trend line A→B (solid).
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();

    // Fan rays (dashed, thinner).
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const level of FibFan.LEVELS) {
      const levelPrice = a.price + priceRange * level;
      const ty = viewport.priceToY(levelPrice);
      const end = this._toEdge(ax, ay, bx, ty, layout);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      // Label near B's x, on the ray.
      if (ty >= layout.chartTop && ty <= layout.chartBottom) {
        const labelX = Math.min(bx + 4, layout.chartRight - 36);
        ctx.fillText(`${(level * 100).toFixed(1)}%`, labelX, ty);
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  override hitTest(
    px: number,
    py: number,
    layout: ChartLayout,
    viewport: Viewport,
    tolerance: number = DRAWING_HIT_TOLERANCE_PX,
  ): boolean {
    if (this.points.length < 2) return false;
    if (px < layout.chartLeft || px > layout.chartRight) return false;
    if (py < layout.chartTop || py > layout.chartBottom) return false;
    const [a, b] = this.points as [AnchorPoint, AnchorPoint];
    const ax = viewport.indexToX(a.index);
    const ay = viewport.priceToY(a.price);
    const bx = viewport.indexToX(b.index);
    const by = viewport.priceToY(b.price);
    if (ax === bx && ay === by) return false;
    const priceRange = b.price - a.price;
    // Base line first.
    let min = distanceToSegment(px, py, ax, ay, bx, by);
    for (const level of FibFan.LEVELS) {
      const ty = viewport.priceToY(a.price + priceRange * level);
      const end = this._toEdge(ax, ay, bx, ty, layout);
      min = Math.min(min, distanceToSegment(px, py, ax, ay, end.x, end.y));
    }
    return min <= tolerance;
  }
}
