import { Drawing, type AnchorPoint } from './Drawing';
import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';
import { DRAWING_HIT_TOLERANCE_PX } from '../constants';

/**
 * Fibonacci retracement — eight horizontal levels between two anchor
 * points (typically a swing high and low). Each level shows the
 * retracement percentage and price on the right side of the chart.
 *
 * Levels are the conventional Fibonacci set: 0, 23.6, 38.2, 50,
 * 61.8, 78.6, 100, and the 161.8 extension. The first anchor is
 * level 0; the second is level 100 (so a downswing from high to low
 * places level 0 at the high). Pure-anchor model: when the user pans
 * or zooms, the levels stick to the underlying candles.
 */
export class FibRetracement extends Drawing {
  static readonly KIND = 'fib';
  static readonly LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618];

  get kind(): string {
    return FibRetracement.KIND;
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
    const x2 = viewport.indexToX(b.index);
    const xLeft = Math.min(x1, x2);
    const xRight = Math.max(x1, x2);
    const priceRange = b.price - a.price;

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

    for (const level of FibRetracement.LEVELS) {
      const price = a.price + priceRange * level;
      const y = Math.round(viewport.priceToY(price)) + 0.5;
      if (y < layout.chartTop || y > layout.chartBottom) continue;

      // Solid line at 0 and 1 (the anchors), dashed elsewhere — easy
      // visual cue for where the swing starts and ends.
      ctx.setLineDash(level === 0 || level === 1 ? [] : [3, 3]);
      ctx.beginPath();
      ctx.moveTo(xLeft, y);
      ctx.lineTo(layout.chartRight, y);
      ctx.stroke();

      // Inline label just past the right anchor of the swing.
      const labelX = Math.min(xRight + 4, layout.chartRight - 50);
      ctx.fillText(
        `${(level * 100).toFixed(1)}%  ${price.toFixed(2)}`,
        labelX,
        y,
      );
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  override hitTest(
    px: number,
    py: number,
    layout: ChartLayout,
    viewport: Viewport,
    tolerance: number = DRAWING_HIT_TOLERANCE_PX,
  ): boolean {
    if (this.points.length < 2) return false;
    const [a, b] = this.points as [AnchorPoint, AnchorPoint];
    const x1 = viewport.indexToX(a.index);
    const x2 = viewport.indexToX(b.index);
    const xLeft = Math.min(x1, x2);
    // Level lines span [xLeft, chartRight].
    if (px < xLeft - tolerance || px > layout.chartRight) return false;
    const priceRange = b.price - a.price;
    for (const level of FibRetracement.LEVELS) {
      const price = a.price + priceRange * level;
      const ly = viewport.priceToY(price);
      if (ly < layout.chartTop || ly > layout.chartBottom) continue;
      if (Math.abs(py - ly) <= tolerance) return true;
    }
    return false;
  }
}
