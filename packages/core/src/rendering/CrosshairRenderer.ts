import type { ThemeColors, ChartLayout } from '../types';
import { formatPrice } from '../utils';
import type { Viewport } from '../interaction/Viewport';

export interface CrosshairState {
  x: number;
  y: number;
  price: number;
  time: string;
  visible: boolean;
}

export class CrosshairRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    state: CrosshairState,
    theme: ThemeColors,
    customPriceFormat?: (price: number) => string,
  ): void {
    if (!state.visible) return;

    const { x, y, price, time } = state;
    const fmt = customPriceFormat || formatPrice;

    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = theme.crosshair;
    ctx.lineWidth = 1;

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(layout.chartLeft, Math.round(y) + 0.5);
    ctx.lineTo(layout.chartRight, Math.round(y) + 0.5);
    ctx.stroke();

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, layout.chartTop);
    ctx.lineTo(Math.round(x) + 0.5, layout.chartBottom);
    ctx.stroke();

    ctx.setLineDash([]);

    // Price label on Y-axis
    const priceText = fmt(price);
    const labelHeight = 20;
    const priceWidth = layout.priceAxisWidth - 4;

    ctx.fillStyle = theme.crosshair;
    ctx.fillRect(layout.chartRight + 2, y - labelHeight / 2, priceWidth, labelHeight);
    ctx.fillStyle = '#ffffff';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(priceText, layout.chartRight + 8, y);

    // Time label on X-axis
    ctx.font = '11px monospace';
    const timeWidth = ctx.measureText(time).width + 12;
    ctx.fillStyle = theme.crosshair;
    ctx.fillRect(x - timeWidth / 2, layout.chartBottom + 2, timeWidth, 20);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(time, x, layout.chartBottom + 6);
  }
}
