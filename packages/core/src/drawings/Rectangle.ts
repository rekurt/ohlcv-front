import { Drawing, type AnchorPoint } from './Drawing';
import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';

/**
 * Axis-aligned rectangle anchored by two diagonal corners. Useful for
 * marking consolidation zones, supply/demand boxes, and breakeven
 * targets.
 *
 * Renders a 1.5px outline plus a faint translucent fill (12% alpha)
 * so overlapping rectangles remain readable.
 */
export class Rectangle extends Drawing {
  static readonly KIND = 'rectangle';

  get kind(): string {
    return Rectangle.KIND;
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

    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);

    const stroke = this.color ?? theme.text;
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      layout.chartLeft,
      layout.chartTop,
      layout.chartRight - layout.chartLeft,
      layout.chartBottom - layout.chartTop,
    );
    ctx.clip();

    ctx.fillStyle = withAlpha(stroke, 0.12);
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);

    ctx.restore();
  }
}

/**
 * Best-effort alpha overlay for a CSS color string. Handles `#rrggbb`
 * and `rgb(...)`; anything else passes through unchanged so theme
 * authors can supply pre-mixed colors if needed.
 */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    const hex = color.length === 4
      ? color
          .slice(1)
          .split('')
          .map((c) => c + c)
          .join('')
      : color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  }
  return color;
}
