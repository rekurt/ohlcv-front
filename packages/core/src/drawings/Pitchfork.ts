import { Drawing, type AnchorPoint } from './Drawing';
import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';
import { DRAWING_HIT_TOLERANCE_PX } from '../constants';
import { colorWithAlpha, distanceToSegment } from './geometry';

/**
 * Andrews' pitchfork — three anchor points:
 *   A → the handle origin (a pivot)
 *   B, C → the two reaction pivots
 *
 * The *median line* runs from A through the midpoint M of segment B→C
 * and extends to the right edge. Two *tine* lines, parallel to the
 * median, pass through B and C. The area between the outer tines is
 * lightly filled so the channel reads at a glance.
 *
 * Geometry is computed in screen space from the projected anchors so the
 * fork stays visually parallel under any price re-scale (mirrors how the
 * {@link Ray} computes its direction).
 */
export class Pitchfork extends Drawing {
  static readonly KIND = 'pitchfork';

  get kind(): string {
    return Pitchfork.KIND;
  }
  get requiredPoints(): number {
    return 3;
  }

  /**
   * Project the three anchors and derive the median direction + the two
   * tine origins, all in screen pixels. Returns null when the direction
   * is degenerate (A coincides with the B–C midpoint).
   */
  private _project(viewport: Viewport): {
    ax: number;
    ay: number;
    mx: number;
    my: number;
    bx: number;
    by: number;
    cx: number;
    cy: number;
    dx: number;
    dy: number;
  } | null {
    const [a, b, c] = this.points as [AnchorPoint, AnchorPoint, AnchorPoint];
    const ax = viewport.indexToX(a.index);
    const ay = viewport.priceToY(a.price);
    const bx = viewport.indexToX(b.index);
    const by = viewport.priceToY(b.price);
    const cx = viewport.indexToX(c.index);
    const cy = viewport.priceToY(c.price);
    const mx = (bx + cx) / 2;
    const my = (by + cy) / 2;
    const dx = mx - ax;
    const dy = my - ay;
    if (dx === 0 && dy === 0) return null;
    return { ax, ay, mx, my, bx, by, cx, cy, dx, dy };
  }

  /** Extend (ox, oy) along (dx, dy) to the chart edge, returning the endpoint. */
  private _toEdge(
    ox: number,
    oy: number,
    dx: number,
    dy: number,
    layout: ChartLayout,
  ): { x: number; y: number } {
    if (dx === 0) {
      return { x: ox, y: dy > 0 ? layout.chartBottom : layout.chartTop };
    }
    const endX = dx > 0 ? layout.chartRight : layout.chartLeft;
    const endY = oy + (dy / dx) * (endX - ox);
    return { x: endX, y: endY };
  }

  override render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    theme: ThemeColors,
  ): void {
    if (this.points.length < 3) return;
    const p = this._project(viewport);
    if (p === null) return;

    const median = this._toEdge(p.ax, p.ay, p.dx, p.dy, layout);
    const tineB = this._toEdge(p.bx, p.by, p.dx, p.dy, layout);
    const tineC = this._toEdge(p.cx, p.cy, p.dx, p.dy, layout);

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

    // Translucent fill between the outer tines (through B and C).
    ctx.fillStyle = colorWithAlpha(color, 0.06);
    ctx.beginPath();
    ctx.moveTo(p.bx, p.by);
    ctx.lineTo(tineB.x, tineB.y);
    ctx.lineTo(tineC.x, tineC.y);
    ctx.lineTo(p.cx, p.cy);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = color;
    // Handle: A → midpoint M (solid, slightly heavier).
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.ax, p.ay);
    ctx.lineTo(p.mx, p.my);
    ctx.stroke();
    // Base line connecting the two pivots B–C.
    ctx.beginPath();
    ctx.moveTo(p.bx, p.by);
    ctx.lineTo(p.cx, p.cy);
    ctx.stroke();
    // Median line from M onward to the edge.
    ctx.beginPath();
    ctx.moveTo(p.mx, p.my);
    ctx.lineTo(median.x, median.y);
    ctx.stroke();
    // Tine lines through B and C.
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.bx, p.by);
    ctx.lineTo(tineB.x, tineB.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.cx, p.cy);
    ctx.lineTo(tineC.x, tineC.y);
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
    const p = this._project(viewport);
    if (p === null) return false;
    const median = this._toEdge(p.ax, p.ay, p.dx, p.dy, layout);
    const tineB = this._toEdge(p.bx, p.by, p.dx, p.dy, layout);
    const tineC = this._toEdge(p.cx, p.cy, p.dx, p.dy, layout);
    const dHandle = distanceToSegment(px, py, p.ax, p.ay, p.mx, p.my);
    const dMedian = distanceToSegment(px, py, p.mx, p.my, median.x, median.y);
    const dTineB = distanceToSegment(px, py, p.bx, p.by, tineB.x, tineB.y);
    const dTineC = distanceToSegment(px, py, p.cx, p.cy, tineC.x, tineC.y);
    const dBase = distanceToSegment(px, py, p.bx, p.by, p.cx, p.cy);
    return Math.min(dHandle, dMedian, dTineB, dTineC, dBase) <= tolerance;
  }
}
