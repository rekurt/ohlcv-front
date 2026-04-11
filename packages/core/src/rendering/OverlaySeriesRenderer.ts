import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';
import type { IndicatorSeries } from '../indicators/Indicator';

/**
 * Generic line renderer for a single indicator series (SMA, EMA,
 * Bollinger band, VWAP, etc.). Values that are NaN (warmup period)
 * create a break in the line instead of drawing to (x, NaN).
 *
 * Values are aligned with the buffer index — no offset magic. The
 * viewport knows how to project any `bufferIndex` to an X coordinate.
 */
export class OverlaySeriesRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    series: IndicatorSeries,
    color: string,
    _theme: ThemeColors,
  ): void {
    const values = series.values;
    if (values.length === 0) return;

    const startIdx = Math.max(0, Math.floor(viewport.startIndex) - 2);
    const endIdx = Math.min(
      values.length,
      Math.ceil(viewport.startIndex + viewport.visibleCount) + 2,
    );
    if (startIdx >= endIdx) return;

    ctx.save();
    // Clip to chart area so lines don't leak into axis regions.
    ctx.beginPath();
    ctx.rect(
      layout.chartLeft,
      layout.chartTop,
      layout.chartRight - layout.chartLeft,
      layout.chartBottom - layout.chartTop,
    );
    ctx.clip();

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();

    let pen = false;
    for (let i = startIdx; i < endIdx; i++) {
      const value = values[i]!;
      if (!Number.isFinite(value)) {
        pen = false;
        continue;
      }
      const x = viewport.indexToX(i);
      const y = viewport.priceToY(value);
      if (!pen) {
        ctx.moveTo(x, y);
        pen = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }
}
