import type { ThemeColors, ChartLayout, CandleView } from '../types';
import { WICK_WIDTH, MIN_CANDLE_BODY_HEIGHT } from '../constants';
import type { Viewport } from '../interaction/Viewport';

export class CandleRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    view: CandleView,
    theme: ThemeColors,
  ): void {
    const bodyWidth = viewport.candleWidth;

    // Two-pass rendering: bearish first, then bullish (minimize fillStyle changes)
    this._renderPass(ctx, layout, viewport, view, theme.bearCandle, false, bodyWidth);
    this._renderPass(ctx, layout, viewport, view, theme.bullCandle, true, bodyWidth);
  }

  private _renderPass(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    view: CandleView,
    color: string,
    isBull: boolean,
    bodyWidth: number,
  ): void {
    ctx.fillStyle = color;

    for (let i = 0; i < view.length; i++) {
      const open = view.open[i];
      const close = view.close[i];
      const bull = close >= open;
      if (bull !== isBull) continue;

      const bufferIndex = view.offset + i;
      const x = viewport.indexToX(bufferIndex);
      const halfBody = bodyWidth / 2;

      // Skip if outside visible area
      if (x + halfBody < layout.chartLeft || x - halfBody > layout.chartRight) continue;

      const high = view.high[i];
      const low = view.low[i];

      // Wick
      const wickX = Math.round(x) - WICK_WIDTH / 2;
      const wickTop = viewport.priceToY(high);
      const wickBottom = viewport.priceToY(low);
      ctx.fillRect(wickX, wickTop, WICK_WIDTH, wickBottom - wickTop);

      // Body
      const bodyTop = viewport.priceToY(Math.max(open, close));
      const bodyBottom = viewport.priceToY(Math.min(open, close));
      const bodyHeight = Math.max(MIN_CANDLE_BODY_HEIGHT, bodyBottom - bodyTop);
      ctx.fillRect(Math.round(x - halfBody), bodyTop, bodyWidth, bodyHeight);
    }
  }
}
