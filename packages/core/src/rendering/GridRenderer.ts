import type { ThemeColors, ChartLayout } from '../types';
import type { Viewport } from '../interaction/Viewport';

export class GridRenderer {
  render(ctx: CanvasRenderingContext2D, layout: ChartLayout, viewport: Viewport, theme: ThemeColors): void {
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;

    // Horizontal grid lines (price). Tick selection is delegated to the
    // viewport so the grid and the price axis use one source of truth
    // across linear / log / percentage / indexed scale modes.
    const ticks = viewport.gridTicks(6);
    ctx.beginPath();
    for (const tick of ticks) {
      const y = Math.round(tick.y) + 0.5;
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
