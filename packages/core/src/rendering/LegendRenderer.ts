import type { Candle, ThemeColors, ChartLayout } from '../types';
import { formatPrice, formatVolume } from '../utils';
import type { Messages } from '../i18n/messages';
import { DEFAULT_MESSAGES } from '../i18n/messages';
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
    // C6: localized single-letter OHLCV labels. Defaults to the English
    // O/H/L/C/V so callers that don't pass messages render as before.
    messages: Messages = DEFAULT_MESSAGES,
  ): void {
    if (!candle) return;

    const pFmt = customPriceFormat || formatPrice;
    const vFmt = customVolumeFormat || formatVolume;

    const isBull = candle.c >= candle.o;
    const x = layout.chartLeft + LEGEND_MARGIN_LEFT;
    const y = Math.round(layout.chartTop + LEGEND_MARGIN_TOP);

    ctx.font = LEGEND_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Symbol & resolution — pixel-snap X too as we accumulate widths.
    ctx.fillStyle = theme.text;
    let offsetX = Math.round(x);
    ctx.fillText(`${symbol} ${resolution}`, offsetX, y);
    offsetX = Math.round(offsetX + ctx.measureText(`${symbol} ${resolution}  `).width);

    // OHLCV values with color
    const color = isBull ? theme.bullCandle : theme.bearCandle;
    ctx.fillStyle = color;

    const parts = [
      `${messages.legendOpen} ${pFmt(candle.o)}`,
      `${messages.legendHigh} ${pFmt(candle.h)}`,
      `${messages.legendLow} ${pFmt(candle.l)}`,
      `${messages.legendClose} ${pFmt(candle.c)}`,
      `${messages.legendVolume} ${vFmt(candle.v)}`,
    ];

    for (const part of parts) {
      ctx.fillText(part, offsetX, y);
      offsetX = Math.round(offsetX + ctx.measureText(part + '  ').width);
    }
  }
}
