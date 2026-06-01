import type { ChartLayout, CandleView, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';
import { withAlpha } from './AreaRenderer';

/**
 * Per-series options for {@link BaselineRenderer}. All optional — omit for a
 * sensible default (base value = first visible close, bull/bear theme colors).
 */
export interface BaselineRenderOptions {
  /**
   * Price level the series is colored relative to. Above it uses the "top"
   * colors, below it the "bottom" colors. Defaults to the first visible close
   * (a dynamic baseline that tracks horizontal scroll) when omitted.
   */
  baseValue?: number;
  /** Fill color above the baseline. Default: `theme.bullCandle`. */
  topFill?: string;
  /** Fill color below the baseline. Default: `theme.bearCandle`. */
  bottomFill?: string;
  /** Line color above the baseline. Default: `theme.bullCandle`. */
  topLine?: string;
  /** Line color below the baseline. Default: `theme.bearCandle`. */
  bottomLine?: string;
}

const TOP = 0;
const BOTTOM = 1;

/**
 * Renders the close-price series as a two-color baseline chart: the area and
 * line above `baseValue` are drawn in the "top" color, below it in the
 * "bottom" color. This matches lightweight-charts' BaselineSeries.
 *
 * The two-color split is achieved with a horizontal clip at the baseline Y
 * rather than by computing line/baseline intersections: the full fill polygon
 * (close path closed down/up to the baseline) and the full close line are each
 * painted twice — once clipped to the region above the baseline with the top
 * colors, once clipped below with the bottom colors. The clip cleanly cuts
 * each pass to its half, so crossings render correctly with no seam math.
 */
export class BaselineRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    view: CandleView,
    theme: ThemeColors,
    opts?: BaselineRenderOptions,
  ): void {
    if (view.length === 0) return;

    // Collect visible, finite close points once (shared by fill + line).
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < view.length; i++) {
      const bufferIndex = view.repIndex ? view.repIndex[i]! : view.offset + i;
      const x = viewport.indexToX(bufferIndex);
      if (x < layout.chartLeft - 10 || x > layout.chartRight + 10) continue;
      const close = view.close[i]!;
      if (!Number.isFinite(close)) continue;
      xs.push(x);
      ys.push(viewport.priceToY(close));
    }
    if (xs.length === 0) return;

    // Base value: explicit option, else the first visible finite close.
    let baseValue = opts?.baseValue;
    if (baseValue === undefined || !Number.isFinite(baseValue)) {
      baseValue = undefined;
      for (let i = 0; i < view.length; i++) {
        const close = view.close[i]!;
        if (Number.isFinite(close)) {
          baseValue = close;
          break;
        }
      }
      if (baseValue === undefined) return;
    }
    const baseY = viewport.priceToY(baseValue);

    const topFill = opts?.topFill ?? theme.bullCandle;
    const bottomFill = opts?.bottomFill ?? theme.bearCandle;
    const topLine = opts?.topLine ?? theme.bullCandle;
    const bottomLine = opts?.bottomLine ?? theme.bearCandle;

    const firstX = xs[0]!;
    const lastX = xs[xs.length - 1]!;
    // Clip boundary clamped into the pane; the fill polygon still uses the
    // true (possibly off-pane) baseY so a baseline outside the visible range
    // colors the whole series with the correct side.
    const splitY = Math.max(layout.chartTop, Math.min(layout.chartBottom, baseY));

    const tracePolygon = (): void => {
      ctx.beginPath();
      ctx.moveTo(firstX, ys[0]!);
      for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i]!, ys[i]!);
      ctx.lineTo(lastX, baseY);
      ctx.lineTo(firstX, baseY);
      ctx.closePath();
    };
    const traceLine = (): void => {
      ctx.beginPath();
      ctx.moveTo(firstX, ys[0]!);
      for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i]!, ys[i]!);
    };

    this._paintRegion(ctx, layout, TOP, splitY, tracePolygon, traceLine, topFill, topLine);
    this._paintRegion(ctx, layout, BOTTOM, splitY, tracePolygon, traceLine, bottomFill, bottomLine);
  }

  private _paintRegion(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    side: typeof TOP | typeof BOTTOM,
    splitY: number,
    tracePolygon: () => void,
    traceLine: () => void,
    fill: string,
    line: string,
  ): void {
    const width = layout.chartRight - layout.chartLeft;
    const regionTop = side === TOP ? layout.chartTop : splitY;
    const regionBottom = side === TOP ? splitY : layout.chartBottom;
    if (regionBottom - regionTop <= 0) return; // baseline outside this side

    ctx.save();
    ctx.beginPath();
    ctx.rect(layout.chartLeft, regionTop, width, regionBottom - regionTop);
    ctx.clip();

    const gradient = ctx.createLinearGradient(0, regionTop, 0, regionBottom);
    if (side === TOP) {
      gradient.addColorStop(0, withAlpha(fill, 0.3));
      gradient.addColorStop(1, withAlpha(fill, 0.02));
    } else {
      gradient.addColorStop(0, withAlpha(fill, 0.02));
      gradient.addColorStop(1, withAlpha(fill, 0.3));
    }
    tracePolygon();
    ctx.fillStyle = gradient;
    ctx.fill();

    traceLine();
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }
}
