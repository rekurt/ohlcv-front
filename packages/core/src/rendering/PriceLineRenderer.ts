import type { ThemeColors, ChartLayout } from '../types';
import type { Viewport } from '../interaction/Viewport';

export class PriceLineRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    price: number,
    theme: ThemeColors,
  ): void {
    const y = viewport.priceToY(price);
    if (y < layout.chartTop || y > layout.chartBottom) return;

    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = theme.priceLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(layout.chartLeft, Math.round(y) + 0.5);
    ctx.lineTo(layout.chartRight, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
