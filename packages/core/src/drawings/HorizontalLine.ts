import { Drawing, type AnchorPoint } from './Drawing';
import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';
import { AXIS_FONT, AXIS_LABEL_HEIGHT, AXIS_LABEL_BG_INSET, AXIS_LABEL_TEXT_PAD, DRAWING_HIT_TOLERANCE_PX } from '../constants';
import { formatPrice } from '../utils';

/**
 * A full-width horizontal line at a constant price. Only the `price`
 * field of the single anchor matters; the `index` is ignored at render
 * time. Ideal for alerts, support/resistance markers, and round-number
 * levels that should stay visible no matter where the user pans.
 *
 * Renders the price label as an inline pill on the right axis so the
 * user can identify the level without hovering.
 */
export class HorizontalLine extends Drawing {
  static readonly KIND = 'hline';

  get kind(): string {
    return HorizontalLine.KIND;
  }
  get requiredPoints(): number {
    return 1;
  }

  override render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    theme: ThemeColors,
  ): void {
    if (this.points.length < 1) return;
    const [anchor] = this.points as [AnchorPoint];
    const y = viewport.priceToY(anchor.price);
    if (y < layout.chartTop || y > layout.chartBottom) return;

    ctx.save();
    ctx.strokeStyle = this.color ?? theme.text;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(layout.chartLeft, Math.round(y) + 0.5);
    ctx.lineTo(layout.chartRight, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    // Price pill on the axis. Use the viewport's scale-aware label so it
    // matches the axis under percentage/indexed modes (falls back to a raw
    // price for linear/log).
    const label = viewport.formatPriceLabel(anchor.price) ?? formatPrice(anchor.price);
    const pillWidth = layout.priceAxisWidth - AXIS_LABEL_BG_INSET * 2;
    ctx.fillStyle = this.color ?? theme.text;
    ctx.fillRect(
      layout.chartRight + AXIS_LABEL_BG_INSET,
      y - AXIS_LABEL_HEIGHT / 2,
      pillWidth,
      AXIS_LABEL_HEIGHT,
    );
    ctx.fillStyle = '#ffffff';
    ctx.font = AXIS_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, layout.chartRight + AXIS_LABEL_TEXT_PAD, y);
    ctx.restore();
  }

  override hitTest(
    x: number,
    y: number,
    layout: ChartLayout,
    viewport: Viewport,
    tolerance: number = DRAWING_HIT_TOLERANCE_PX,
  ): boolean {
    const a = this.points[0];
    if (!a) return false;
    if (x < layout.chartLeft || x > layout.chartRight) return false;
    const ly = viewport.priceToY(a.price);
    if (ly < layout.chartTop || ly > layout.chartBottom) return false;
    return Math.abs(y - ly) <= tolerance;
  }
}
