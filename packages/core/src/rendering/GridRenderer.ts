import type { ThemeColors, ChartLayout } from '../types';
import { niceGridValues } from '../utils';
import type { Viewport } from '../interaction/Viewport';

export class GridRenderer {
  render(ctx: CanvasRenderingContext2D, layout: ChartLayout, viewport: Viewport, theme: ThemeColors): void {
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;

    // Horizontal grid lines (price)
    const priceValues = niceGridValues(viewport.priceMin, viewport.priceMax, 6);
    ctx.beginPath();
    for (const price of priceValues) {
      const y = Math.round(viewport.priceToY(price)) + 0.5;
      ctx.moveTo(layout.chartLeft, y);
      ctx.lineTo(layout.chartRight, y);
    }
    ctx.stroke();

    // Vertical grid lines (time)
    const step = Math.max(1, Math.floor(viewport.visibleCount / 6));
    const startIdx = Math.max(0, Math.ceil(viewport.startIndex));
    ctx.beginPath();
    for (let i = startIdx; i < startIdx + viewport.visibleCount; i += step) {
      const x = Math.round(viewport.indexToX(i)) + 0.5;
      if (x >= layout.chartLeft && x <= layout.chartRight) {
        ctx.moveTo(x, layout.chartTop);
        ctx.lineTo(x, layout.chartBottom);
      }
    }
    ctx.stroke();
  }
}
