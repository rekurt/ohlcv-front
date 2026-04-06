import type { ThemeColors, ChartLayout } from '../types';
import { niceGridValues, formatPrice } from '../utils';
import type { Viewport } from '../interaction/Viewport';

export class PriceAxisRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    theme: ThemeColors,
    customFormat?: (price: number) => string,
  ): void {
    const fmt = customFormat || formatPrice;
    const axisX = layout.chartRight;

    // Axis line
    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX + 0.5, layout.chartTop);
    ctx.lineTo(axisX + 0.5, layout.chartBottom);
    ctx.stroke();

    // Price labels
    const values = niceGridValues(viewport.priceMin, viewport.priceMax, 6);
    ctx.fillStyle = theme.text;
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (const price of values) {
      const y = viewport.priceToY(price);
      if (y >= layout.chartTop && y <= layout.chartBottom) {
        ctx.fillText(fmt(price), axisX + 8, y);
      }
    }
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
    const text = fmt(price);
    const labelHeight = 20;
    const labelWidth = layout.priceAxisWidth - 4;

    // Background
    ctx.fillStyle = isBull ? theme.bullCandle : theme.bearCandle;
    ctx.fillRect(axisX + 2, y - labelHeight / 2, labelWidth, labelHeight);

    // Text
    ctx.fillStyle = '#ffffff';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, axisX + 8, y);
  }
}
