import type { ThemeColors, ChartLayout } from '../types';
import { formatPrice, niceGridValues } from '../utils';
import type { Viewport, PriceScaleSide } from '../interaction/Viewport';
import {
  AXIS_FONT,
  AXIS_LABEL_HEIGHT,
  AXIS_LABEL_TEXT_PAD,
  AXIS_LABEL_BG_INSET,
} from '../constants';

export class PriceAxisRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    theme: ThemeColors,
    customFormat?: (price: number) => string,
    side: PriceScaleSide = 'right',
  ): void {
    if (side === 'left') {
      this._renderLeft(ctx, layout, viewport, theme, customFormat);
      return;
    }
    const fmt = customFormat || formatPrice;
    const axisX = layout.chartRight;

    // Axis line
    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX + 0.5, layout.chartTop);
    ctx.lineTo(axisX + 0.5, layout.chartBottom);
    ctx.stroke();

    // Price labels. Ticks come from the viewport so axis + grid agree
    // across scale modes. `tick.label` is pre-formatted for
    // percentage/indexed axes; for linear/log it's null and we apply the
    // host's price formatter.
    const ticks = viewport.gridTicks(6);
    ctx.fillStyle = theme.text;
    ctx.font = AXIS_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (const tick of ticks) {
      if (tick.y >= layout.chartTop && tick.y <= layout.chartBottom) {
        // Round the baseline to whole pixels so text rasterizes
        // sharply on DPR=1 displays.
        ctx.fillText(tick.label ?? fmt(tick.price), axisX + AXIS_LABEL_TEXT_PAD, Math.round(tick.y));
      }
    }
  }

  /**
   * Render the optional secondary (left) price axis (B2). Linear-only:
   * ticks come from `niceGridValues` over the left extrema and project
   * through the viewport's left scale. The axis line sits at `chartLeft`
   * (the right edge of the reserved left strip) and labels are
   * right-aligned just inside it, mirroring the right axis.
   */
  private _renderLeft(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    theme: ThemeColors,
    customFormat?: (price: number) => string,
  ): void {
    const fmt = customFormat || formatPrice;
    // Axis line at the inner edge of the left strip (== chartLeft).
    const axisX = layout.chartLeft;
    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX - 0.5, layout.chartTop);
    ctx.lineTo(axisX - 0.5, layout.chartBottom);
    ctx.stroke();

    ctx.fillStyle = theme.text;
    ctx.font = AXIS_FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (const price of niceGridValues(viewport.leftPriceMin, viewport.leftPriceMax, 6)) {
      const y = viewport.priceToY(price, 'left');
      if (y >= layout.chartTop && y <= layout.chartBottom) {
        ctx.fillText(fmt(price), axisX - AXIS_LABEL_TEXT_PAD, Math.round(y));
      }
    }
    // Restore default alignment for any subsequent text draws on this ctx.
    ctx.textAlign = 'left';
  }

  /** Draw highlighted current price label */
  drawCurrentPrice(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    price: number,
    isBull: boolean,
    theme: ThemeColors,
    customFormat?: (price: number) => string,
  ): void {
    const fmt = customFormat || formatPrice;
    const y = viewport.priceToY(price);
    if (y < layout.chartTop || y > layout.chartBottom) return;

    const axisX = layout.chartRight;
    // In percentage/indexed modes use the transformed label (e.g. "+10.00%")
    // so the pill matches the grid-tick labels — not a raw price.
    const text = viewport.formatPriceLabel(price) ?? fmt(price);
    const labelWidth = layout.priceAxisWidth - AXIS_LABEL_BG_INSET * 2;

    // Background — round the y origin so the rectangle aligns to a
    // whole pixel and doesn't fringe.
    const yi = Math.round(y - AXIS_LABEL_HEIGHT / 2);
    ctx.fillStyle = isBull ? theme.bullCandle : theme.bearCandle;
    ctx.fillRect(axisX + AXIS_LABEL_BG_INSET, yi, labelWidth, AXIS_LABEL_HEIGHT);

    // Text
    ctx.fillStyle = '#ffffff';
    ctx.font = AXIS_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, axisX + AXIS_LABEL_TEXT_PAD, Math.round(y));
  }
}
