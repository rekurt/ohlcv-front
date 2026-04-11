import { Drawing, type AnchorPoint } from './Drawing';
import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';

/**
 * Straight line segment between two anchor points. The quintessential
 * drawing primitive — anchored in buffer space so it sticks to the
 * underlying candles on pan/zoom.
 */
export class TrendLine extends Drawing {
  static readonly KIND = 'trendline';

  get kind(): string {
    return TrendLine.KIND;
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
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.restore();
  }
}
