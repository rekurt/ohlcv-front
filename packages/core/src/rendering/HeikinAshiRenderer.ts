import type { ThemeColors, ChartLayout, CandleView } from '../types';
import type { Viewport } from '../interaction/Viewport';
import type { CandleBuffer } from '../data/CandleBuffer';
import { CandleRenderer } from './CandleRenderer';

/**
 * Renders the visible window as Heikin-Ashi candles.
 *
 * Heikin-Ashi is stateful — `HA.open` depends on the previous HA
 * candle — so computing it only over the visible slice would
 * produce a wrong open at the left edge. We seed the computation
 * with a warmup lead-in of `WARMUP` candles before `start`; the
 * seeding bias decays within a few bars, so the visible range is
 * visually correct.
 *
 * The transformed values are packed into a synthetic `CandleView`
 * (offset = start) and handed to the standard `CandleRenderer`, so
 * HA shares all the candle drawing logic (pixel snapping, two-pass
 * bull/bear fill, min body height).
 */
export class HeikinAshiRenderer {
  static readonly WARMUP = 50;
  private readonly _candleRenderer = new CandleRenderer();

  render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    buffer: CandleBuffer,
    start: number,
    end: number,
    theme: ThemeColors,
  ): void {
    const n = buffer.length;
    if (n === 0 || end <= start) return;

    const from = Math.max(0, start - HeikinAshiRenderer.WARMUP);
    const visibleLen = end - start;

    const open = new Float64Array(visibleLen);
    const high = new Float64Array(visibleLen);
    const low = new Float64Array(visibleLen);
    const close = new Float64Array(visibleLen);
    const volume = new Float64Array(visibleLen);
    const time = new Float64Array(visibleLen);

    // Walk from the warmup lead-in through `end`, carrying HA open/close.
    let prevHaOpen = NaN;
    let prevHaClose = NaN;
    for (let i = from; i < end; i++) {
      const c = buffer.candleAt(i)!;
      const haClose = (c.o + c.h + c.l + c.c) / 4;
      const haOpen =
        Number.isNaN(prevHaOpen) || Number.isNaN(prevHaClose)
          ? (c.o + c.c) / 2
          : (prevHaOpen + prevHaClose) / 2;
      const haHigh = Math.max(c.h, haOpen, haClose);
      const haLow = Math.min(c.l, haOpen, haClose);

      if (i >= start) {
        const j = i - start;
        open[j] = haOpen;
        high[j] = haHigh;
        low[j] = haLow;
        close[j] = haClose;
        volume[j] = c.v;
        time[j] = c.t;
      }

      prevHaOpen = haOpen;
      prevHaClose = haClose;
    }

    const view: CandleView = {
      open,
      high,
      low,
      close,
      volume,
      time,
      length: visibleLen,
      offset: start,
    };

    this._candleRenderer.render(ctx, layout, viewport, view, theme);
  }
}
