import type { ChartLayout, CandleView, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';

/**
 * OHLC bar rendering (also known as "bar chart"): a vertical line from low
 * to high, with a left tick at open and a right tick at close. More compact
 * than candlesticks, sometimes preferred for dense historical views.
 *
 * Color depends on direction (close >= open ? bullish : bearish), matching
 * the candlestick convention so switching chart types doesn't confuse users.
 */
export class OHLCBarRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    view: CandleView,
    theme: ThemeColors,
  ): void {
    const tickLen = Math.max(2, Math.floor(viewport.candleWidth / 2));

    ctx.save();
    ctx.beginPath();
    ctx.rect(
      layout.chartLeft,
      layout.chartTop,
      layout.chartRight - layout.chartLeft,
      layout.chartBottom - layout.chartTop,
    );
    ctx.clip();

    // Two-pass: stroke all bearish bars in one color, then bullish.
    this._drawPass(ctx, layout, viewport, view, theme.bearCandle, false, tickLen);
    this._drawPass(ctx, layout, viewport, view, theme.bullCandle, true, tickLen);

    ctx.restore();
  }

  private _drawPass(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    view: CandleView,
    color: string,
    wantBull: boolean,
    tickLen: number,
  ): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < view.length; i++) {
      const open = view.open[i]!;
      const close = view.close[i]!;
      const bull = close >= open;
      if (bull !== wantBull) continue;

      const bufferIndex = view.repIndex ? view.repIndex[i]! : view.offset + i;
      const x = viewport.indexToX(bufferIndex);
      if (x + tickLen < layout.chartLeft || x - tickLen > layout.chartRight) continue;

      const yHigh = viewport.priceToY(view.high[i]!);
      const yLow = viewport.priceToY(view.low[i]!);
      const yOpen = viewport.priceToY(open);
      const yClose = viewport.priceToY(close);
      const cx = Math.round(x) + 0.5; // crisp 1px line

      // Vertical low-to-high
      ctx.moveTo(cx, yHigh);
      ctx.lineTo(cx, yLow);

      // Left tick (open)
      ctx.moveTo(cx, yOpen);
      ctx.lineTo(cx - tickLen, yOpen);

      // Right tick (close)
      ctx.moveTo(cx, yClose);
      ctx.lineTo(cx + tickLen, yClose);
    }
    ctx.stroke();
  }
}
