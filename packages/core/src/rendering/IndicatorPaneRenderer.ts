import type { ThemeColors, ChartLayout } from '../types';
import type { Viewport } from '../interaction/Viewport';
import type { IndicatorSeries } from '../indicators/Indicator';
import { AXIS_FONT, LEGEND_FONT } from '../constants';

/**
 * Renders a single sub-pane indicator into a horizontal band of the
 * chart. Each pane has its own auto-scaled Y range (min/max derived
 * from the visible portion of the indicator's first series) so RSI,
 * MACD, OBV, etc. can coexist without crowding the price axis.
 *
 * Coordinate model:
 *   x = viewport.indexToX(i)   (shared with the main chart)
 *   y = paneTop + (1 - t) * (paneBottom - paneTop)
 *       where t = (value - paneMin) / (paneMax - paneMin)
 */
export class IndicatorPaneRenderer {
  /** Color palette shared across pane indicator series. */
  static readonly SERIES_COLORS = [
    '#2962ff',
    '#ff6d00',
    '#aa00ff',
    '#00c853',
    '#ff1744',
    '#00bcd4',
    '#ffd600',
  ];

  /**
   * Render one pane. `colorOffset` is the index into SERIES_COLORS at
   * which to start coloring this pane's series — increment it by the
   * number of series drawn so each pane gets a unique color set.
   *
   * Returns the number of series rendered so the caller can advance
   * its color cursor for the next pane.
   */
  render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    series: IndicatorSeries[],
    paneTop: number,
    paneBottom: number,
    label: string,
    theme: ThemeColors,
    colorOffset: number,
  ): number {
    if (series.length === 0 || paneBottom - paneTop < 4) return 0;
    const [first] = series;
    if (!first) return 0;

    // Auto-scale Y from visible values of every series in this pane,
    // not just the first — MACD's signal + histogram both matter.
    const startIdx = Math.max(0, Math.floor(viewport.startIndex));
    const endIdx = Math.min(
      first.values.length,
      Math.ceil(viewport.startIndex + viewport.visibleCount) + 1,
    );

    let min = Infinity;
    let max = -Infinity;
    for (const s of series) {
      for (let i = startIdx; i < endIdx; i++) {
        const v = s.values[i];
        if (v === undefined || !Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      // No valid values in window — render an empty pane with just
      // its border and label so the user can still see it.
      min = 0;
      max = 1;
    }
    if (min === max) {
      // Constant series — pad to avoid /0 in toY.
      min -= 1;
      max += 1;
    }

    // Background + top divider.
    ctx.save();
    ctx.fillStyle = theme.background;
    ctx.fillRect(layout.chartLeft, paneTop, layout.chartRight - layout.chartLeft, paneBottom - paneTop);

    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(layout.chartLeft, Math.round(paneTop) + 0.5);
    ctx.lineTo(layout.chartRight, Math.round(paneTop) + 0.5);
    ctx.stroke();

    const toY = (value: number): number => {
      const t = (value - min) / (max - min);
      return paneBottom - t * (paneBottom - paneTop);
    };

    // Zero-line (if the range straddles zero) — useful for MACD,
    // Williams %R, CCI.
    if (min < 0 && max > 0) {
      ctx.strokeStyle = theme.grid;
      ctx.setLineDash([2, 3]);
      const yZero = Math.round(toY(0)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(layout.chartLeft, yZero);
      ctx.lineTo(layout.chartRight, yZero);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Clip lines to the pane band.
    ctx.beginPath();
    ctx.rect(
      layout.chartLeft,
      paneTop,
      layout.chartRight - layout.chartLeft,
      paneBottom - paneTop,
    );
    ctx.clip();

    let colorIdx = colorOffset;
    for (const s of series) {
      const color =
        IndicatorPaneRenderer.SERIES_COLORS[
          colorIdx % IndicatorPaneRenderer.SERIES_COLORS.length
        ]!;
      colorIdx++;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      for (let i = startIdx; i < endIdx; i++) {
        const v = s.values[i];
        if (v === undefined || !Number.isFinite(v)) {
          started = false;
          continue;
        }
        const x = viewport.indexToX(i);
        const y = toY(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    ctx.restore();

    // Pane label (top-left) + Y-axis bounds (top-right under the price axis).
    ctx.save();
    ctx.fillStyle = theme.text;
    ctx.font = LEGEND_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, Math.round(layout.chartLeft + 6), Math.round(paneTop + 4));

    ctx.font = AXIS_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatBound(max), Math.round(layout.chartRight + 4), Math.round(paneTop + 8));
    ctx.fillText(formatBound(min), Math.round(layout.chartRight + 4), Math.round(paneBottom - 8));
    ctx.restore();

    return series.length;
  }
}

function formatBound(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e6) return v.toExponential(2);
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 1) return v.toFixed(2);
  return v.toFixed(3);
}
