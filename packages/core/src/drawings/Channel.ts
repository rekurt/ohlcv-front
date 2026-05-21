import { Drawing, type AnchorPoint } from './Drawing';
import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';

/**
 * Equidistant channel — three anchor points: two on one boundary
 * (defining the channel slope), one on the parallel boundary. The
 * second boundary is rendered as a parallel line offset by the
 * vertical distance between A→B and C (measured in price-space at
 * C's index).
 *
 * Anchors:
 *   A, B → the first (primary) boundary line
 *   C    → a single point on the parallel boundary
 *
 * The fill between the two lines is translucent (8% alpha) so
 * overlapping channels remain readable.
 */
export class Channel extends Drawing {
  static readonly KIND = 'channel';

  get kind(): string {
    return Channel.KIND;
  }
  get requiredPoints(): number {
    return 3;
  }

  override render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    theme: ThemeColors,
  ): void {
    if (this.points.length < 3) return;
    const [a, b, c] = this.points as [AnchorPoint, AnchorPoint, AnchorPoint];

    if (b.index === a.index) return; // vertical degenerate

    // Slope of the primary boundary in price-per-index.
    const slope = (b.price - a.price) / (b.index - a.index);
    // Price on the primary line at C's index.
    const pricePrimaryAtC = a.price + slope * (c.index - a.index);
    // Vertical offset of the parallel boundary, in price units.
    const offset = c.price - pricePrimaryAtC;

    // Compute screen-space endpoints. We extend the channel lines
    // across the visible window so the lines look infinite.
    const startIndex = viewport.startIndex;
    const endIndex = viewport.startIndex + viewport.visibleCount;
    const xLeft = viewport.indexToX(startIndex);
    const xRight = viewport.indexToX(endIndex);
    const yPriA = viewport.priceToY(a.price + slope * (startIndex - a.index));
    const yPriB = viewport.priceToY(a.price + slope * (endIndex - a.index));
    const ySecA = viewport.priceToY(a.price + slope * (startIndex - a.index) + offset);
    const ySecB = viewport.priceToY(a.price + slope * (endIndex - a.index) + offset);

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

    // Translucent fill between the two boundaries.
    ctx.fillStyle = toAlpha(color, 0.08);
    ctx.beginPath();
    ctx.moveTo(xLeft, yPriA);
    ctx.lineTo(xRight, yPriB);
    ctx.lineTo(xRight, ySecB);
    ctx.lineTo(xLeft, ySecA);
    ctx.closePath();
    ctx.fill();

    // Lines.
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xLeft, yPriA);
    ctx.lineTo(xRight, yPriB);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(xLeft, ySecA);
    ctx.lineTo(xRight, ySecB);
    ctx.stroke();

    ctx.restore();
  }
}

function toAlpha(color: string, alpha: number): string {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    const hex =
      color.length === 4
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
