import type { ThemeColors, ChartLayout } from '../types';
import { formatPrice } from '../utils';
import type { Viewport } from '../interaction/Viewport';
import {
  AXIS_FONT,
  AXIS_LABEL_HEIGHT,
  AXIS_LABEL_TEXT_PAD,
  AXIS_LABEL_BG_INSET,
  CROSSHAIR_DASH,
  CROSSHAIR_TIME_LABEL_PAD_X,
} from '../constants';

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
    _viewport: Viewport,
    state: CrosshairState,
    theme: ThemeColors,
    customPriceFormat?: (price: number) => string,
  ): void {
    if (!state.visible) return;

    const { x, y, price, time } = state;
    const fmt = customPriceFormat || formatPrice;

    ctx.setLineDash(CROSSHAIR_DASH as unknown as number[]);
    ctx.strokeStyle = theme.crosshair;
    ctx.lineWidth = 1;

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(layout.chartLeft, Math.round(y) + 0.5);
    ctx.lineTo(layout.chartRight, Math.round(y) + 0.5);
    ctx.stroke();

    // Vertical line — extends through any sub-pane bands so the user
    // can read pane indicator values at the same time index.
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, layout.chartTop);
    ctx.lineTo(Math.round(x) + 0.5, layout.paneAreaBottom);
    ctx.stroke();

    ctx.setLineDash([]);

    // Price label on Y-axis — pixel-snapped to keep text sharp.
    const priceText = fmt(price);
    const priceWidth = layout.priceAxisWidth - AXIS_LABEL_BG_INSET * 2;
    const priceY = Math.round(y - AXIS_LABEL_HEIGHT / 2);

    ctx.fillStyle = theme.crosshair;
    ctx.fillRect(
      layout.chartRight + AXIS_LABEL_BG_INSET,
      priceY,
      priceWidth,
      AXIS_LABEL_HEIGHT,
    );
    ctx.fillStyle = '#ffffff';
    ctx.font = AXIS_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(priceText, layout.chartRight + AXIS_LABEL_TEXT_PAD, Math.round(y));

    // Time label on X-axis
    ctx.font = AXIS_FONT;
    const timeWidth = ctx.measureText(time).width + CROSSHAIR_TIME_LABEL_PAD_X;
    const timeBgX = Math.round(x - timeWidth / 2);
    ctx.fillStyle = theme.crosshair;
    ctx.fillRect(
      timeBgX,
      layout.paneAreaBottom + AXIS_LABEL_BG_INSET,
      timeWidth,
      AXIS_LABEL_HEIGHT,
    );
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(
      time,
      Math.round(x),
      Math.round(layout.paneAreaBottom + AXIS_LABEL_BG_INSET + AXIS_LABEL_TEXT_PAD / 2),
    );
  }
}
