import type { ThemeColors, ChartLayout, CandleView } from '../types';
import type { Viewport } from '../interaction/Viewport';
import type { CandleBuffer } from '../data/CandleBuffer';
import { CandleRenderer } from './CandleRenderer';

/** Warmup lead-in (candles before `start`) that seeds the stateful HA open. */
export const HEIKIN_ASHI_WARMUP = 50;

/**
 * Build a synthetic Heikin-Ashi `CandleView` for the window [start, end),
 * seeded with a warmup lead-in so the left-edge open is correct. Shared by
 * {@link HeikinAshiRenderer} and the `heikinashi` series definition so the
 * transform lives in exactly one place.
 */
export function buildHeikinAshiView(
  buffer: CandleBuffer,
  start: number,
  end: number,
): CandleView {
  const n = buffer.length;
  const s = Math.max(0, start);
  const e = Math.min(n, end);
  const visibleLen = Math.max(0, e - s);
  const open = new Float64Array(visibleLen);
  const high = new Float64Array(visibleLen);
  const low = new Float64Array(visibleLen);
  const close = new Float64Array(visibleLen);
  const volume = new Float64Array(visibleLen);
  const time = new Float64Array(visibleLen);
  if (visibleLen === 0) {
    return { open, high, low, close, volume, time, length: 0, offset: s };
  }

  const from = Math.max(0, s - HEIKIN_ASHI_WARMUP);
  let prevHaOpen = NaN;
  let prevHaClose = NaN;
  for (let i = from; i < e; i++) {
    const c = buffer.candleAt(i)!;
    const haClose = (c.o + c.h + c.l + c.c) / 4;
    const haOpen =
      Number.isNaN(prevHaOpen) || Number.isNaN(prevHaClose)
        ? (c.o + c.c) / 2
        : (prevHaOpen + prevHaClose) / 2;
    const haHigh = Math.max(c.h, haOpen, haClose);
    const haLow = Math.min(c.l, haOpen, haClose);

    if (i >= s) {
      const j = i - s;
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

  return { open, high, low, close, volume, time, length: visibleLen, offset: s };
}

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
  static readonly WARMUP = HEIKIN_ASHI_WARMUP;
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
    if (buffer.length === 0 || end <= start) return;
    const view = buildHeikinAshiView(buffer, start, end);
    this._candleRenderer.render(ctx, layout, viewport, view, theme);
  }
}
