import { Drawing, type AnchorPoint } from './Drawing';
import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';

/**
 * Fibonacci extension — three anchor points (A → B → C) that
 * project target levels beyond the swing. Conventionally A and B
 * define the impulse leg and C is the retracement low/high; the
 * extension projects targets above (or below) the impulse using
 * Fibonacci ratios applied to the A→B range from C.
 *
 *   level price = C + ratio * (B − A)
 *
 * Levels emitted: 0, 0.382, 0.618, 1.000, 1.272, 1.618, 2.000, 2.618.
 */
export class FibExtension extends Drawing {
  static readonly KIND = 'fibext';
  static readonly LEVELS = [0, 0.382, 0.618, 1.0, 1.272, 1.618, 2.0, 2.618];

  get kind(): string {
    return FibExtension.KIND;
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

    const impulse = b.price - a.price;

    ctx.save();
    ctx.beginPath();
    ctx.rect(
      layout.chartLeft,
      layout.chartTop,
      layout.chartRight - layout.chartLeft,
      layout.chartBottom - layout.chartTop,
    );
    ctx.clip();

    const color = this.color ?? theme.text;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineWidth = 1;

    const xStart = viewport.indexToX(c.index);
    const xLabel = Math.min(xStart + 6, layout.chartRight - 70);

    for (const level of FibExtension.LEVELS) {
      const price = c.price + level * impulse;
      const y = Math.round(viewport.priceToY(price)) + 0.5;
      if (y < layout.chartTop || y > layout.chartBottom) continue;

      ctx.setLineDash(level === 0 || level === 1 ? [] : [3, 3]);
      ctx.beginPath();
      ctx.moveTo(xStart, y);
      ctx.lineTo(layout.chartRight, y);
      ctx.stroke();

      ctx.fillText(
        `${(level * 100).toFixed(1)}%  ${price.toFixed(2)}`,
        xLabel,
        y,
      );
    }
    ctx.setLineDash([]);
    ctx.restore();
  }
}
