import type { ChartLayout, CandleView, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';

/**
 * Renders the price series as a filled area beneath the close-price line.
 * Equivalent to LineRenderer plus a vertical gradient fill down to
 * chartBottom. Common for index charts and mobile views.
 */
export class AreaRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    view: CandleView,
    theme: ThemeColors,
    fillColor?: string,
    strokeColor?: string,
  ): void {
    if (view.length === 0) return;

    ctx.save();
    // Clip to chart area to keep the fill inside the price pane.
    ctx.beginPath();
    ctx.rect(
      layout.chartLeft,
      layout.chartTop,
      layout.chartRight - layout.chartLeft,
      layout.chartBottom - layout.chartTop,
    );
    ctx.clip();

    // Trace the close-price path, then close down to chartBottom to form
    // a polygon that can be filled.
    ctx.beginPath();
    let started = false;
    let firstX = 0;
    let lastX = 0;
    for (let i = 0; i < view.length; i++) {
      const bufferIndex = view.offset + i;
      const x = viewport.indexToX(bufferIndex);
      if (x < layout.chartLeft - 10 || x > layout.chartRight + 10) continue;
      const y = viewport.priceToY(view.close[i]!);
      if (!started) {
        ctx.moveTo(x, y);
        firstX = x;
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
      lastX = x;
    }
    if (!started) {
      ctx.restore();
      return;
    }
    // Close the polygon along the chart bottom.
    ctx.lineTo(lastX, layout.chartBottom);
    ctx.lineTo(firstX, layout.chartBottom);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, layout.chartTop, 0, layout.chartBottom);
    const solidFill = fillColor ?? theme.bullCandle;
    gradient.addColorStop(0, withAlpha(solidFill, 0.35));
    gradient.addColorStop(1, withAlpha(solidFill, 0));
    ctx.fillStyle = gradient;
    ctx.fill();

    // Stroke the top outline so the price line remains crisp.
    ctx.beginPath();
    let first = true;
    for (let i = 0; i < view.length; i++) {
      const bufferIndex = view.offset + i;
      const x = viewport.indexToX(bufferIndex);
      if (x < layout.chartLeft - 10 || x > layout.chartRight + 10) continue;
      const y = viewport.priceToY(view.close[i]!);
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = strokeColor ?? solidFill;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Add an alpha channel to an arbitrary CSS color string. Uses a tiny
 * Canvas2D hack: let the browser parse the color, then extract RGBA.
 * Returns `rgba(r,g,b,a)` regardless of input format (hex/rgb/rgba/named).
 */
function withAlpha(color: string, alpha: number): string {
  // Fast path for rgba() — just swap the alpha component.
  const rgbaMatch = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbaMatch) {
    return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${alpha})`;
  }
  // Fast path for #rrggbb
  const hex = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (hex) {
    const r = parseInt(hex[1]!, 16);
    const g = parseInt(hex[2]!, 16);
    const b = parseInt(hex[3]!, 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  // Fallback — rely on the consumer to pass rgba/hex; otherwise return
  // the color unchanged (no alpha).
  return color;
}
