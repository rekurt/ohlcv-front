import type { Candle, ThemeColors, ChartLayout } from '../types';
import { formatPrice, formatVolume } from '../utils';
import { LEGEND_FONT, LEGEND_MARGIN_LEFT, LEGEND_MARGIN_TOP } from '../constants';

export class LegendRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    candle: Candle | null,
    symbol: string,
    resolution: string,
    theme: ThemeColors,
    customPriceFormat?: (price: number) => string,
    customVolumeFormat?: (volume: number) => string,
  ): void {
    if (!candle) return;

    const pFmt = customPriceFormat || formatPrice;
    const vFmt = customVolumeFormat || formatVolume;

    const isBull = candle.c >= candle.o;
    const x = layout.chartLeft + LEGEND_MARGIN_LEFT;
    const y = layout.chartTop + LEGEND_MARGIN_TOP;

    ctx.font = LEGEND_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Symbol & resolution
    ctx.fillStyle = theme.text;
    let offsetX = x;
    ctx.fillText(`${symbol} ${resolution}`, offsetX, y);
    offsetX += ctx.measureText(`${symbol} ${resolution}  `).width;

    // OHLCV values with color
    const color = isBull ? theme.bullCandle : theme.bearCandle;
    ctx.fillStyle = color;

    const parts = [
      `O ${pFmt(candle.o)}`,
      `H ${pFmt(candle.h)}`,
      `L ${pFmt(candle.l)}`,
      `C ${pFmt(candle.c)}`,
      `V ${vFmt(candle.v)}`,
    ];

    for (const part of parts) {
      ctx.fillText(part, offsetX, y);
      offsetX += ctx.measureText(part + '  ').width;
    }
  }
}
