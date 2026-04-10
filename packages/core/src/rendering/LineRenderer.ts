import type { ChartLayout, CandleView, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';

/**
 * Renders the price series as a connected line of close values. Alternative
 * to CandleRenderer for low-density views or users who prefer minimalism.
 *
 * Uses the bull candle color as the line color by default; consumers can
 * pass a custom color via the optional parameter.
 */
export class LineRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    view: CandleView,
    theme: ThemeColors,
    color?: string,
  ): void {
    if (view.length === 0) return;

    ctx.save();
    ctx.strokeStyle = color ?? theme.bullCandle;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Clip to chart area so the line doesn't leak into axes.
    ctx.beginPath();
    ctx.rect(
      layout.chartLeft,
      layout.chartTop,
      layout.chartRight - layout.chartLeft,
      layout.chartBottom - layout.chartTop,
    );
    ctx.clip();

    ctx.beginPath();
    let started = false;
    for (let i = 0; i < view.length; i++) {
      const bufferIndex = view.offset + i;
      const x = viewport.indexToX(bufferIndex);
      if (x < layout.chartLeft - 10 || x > layout.chartRight + 10) continue;
      const close = view.close[i]!;
      const y = viewport.priceToY(close);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }
}
