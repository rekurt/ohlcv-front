import { Drawing, type AnchorPoint } from './Drawing';
import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';

/**
 * Single-point vertical guideline locked to a buffer index — useful
 * for marking events (earnings, news, halt). The `price` coordinate
 * of the anchor is ignored; only `index` matters.
 *
 * Renders as a 1px dashed line spanning the full chart height.
 */
export class VerticalLine extends Drawing {
  static readonly KIND = 'vline';
  static readonly DASH = [4, 4];

  get kind(): string {
    return VerticalLine.KIND;
  }
  get requiredPoints(): number {
    return 1;
  }

  override render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    theme: ThemeColors,
  ): void {
    if (this.points.length < 1) return;
    const [a] = this.points as [AnchorPoint];
    const x = Math.round(viewport.indexToX(a.index)) + 0.5;
    if (x < layout.chartLeft || x > layout.chartRight) return;

    ctx.save();
    ctx.strokeStyle = this.color ?? theme.text;
    ctx.lineWidth = 1;
    ctx.setLineDash(VerticalLine.DASH);
    ctx.beginPath();
    ctx.moveTo(x, layout.chartTop);
    ctx.lineTo(x, layout.chartBottom);
    ctx.stroke();
    ctx.restore();
  }
}
