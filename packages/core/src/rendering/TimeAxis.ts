import type { ThemeColors, ChartLayout } from '../types';
import type { Viewport } from '../interaction/Viewport';
import type { CandleBuffer } from '../data/CandleBuffer';
import type { HorzScaleBehavior } from '../horzscale/HorzScaleBehavior';
import { AXIS_FONT, TIME_AXIS_LABEL_GAP } from '../constants';

export class TimeAxisRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    buffer: CandleBuffer,
    horzScale: HorzScaleBehavior,
    theme: ThemeColors,
  ): void {
    // The time axis sits below any sub-pane indicator bands. Use
    // `paneAreaBottom` (== height − timeAxisHeight) instead of
    // `chartBottom` so labels don't render into the first pane.
    const axisY = layout.paneAreaBottom;

    // Axis line
    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(layout.chartLeft, axisY + 0.5);
    ctx.lineTo(layout.chartRight, axisY + 0.5);
    ctx.stroke();

    // Time labels
    ctx.fillStyle = theme.text;
    ctx.font = AXIS_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const step = Math.max(1, Math.floor(viewport.visibleCount / 6));
    const startIdx = Math.max(0, Math.ceil(viewport.startIndex));
    const endIdx = Math.min(buffer.length, Math.ceil(viewport.startIndex + viewport.visibleCount));

    for (let i = startIdx; i < endIdx; i += step) {
      const x = viewport.indexToX(i);
      if (x < layout.chartLeft || x > layout.chartRight) continue;

      // The horizontal-scale behavior maps the index to its domain value
      // (time, strike, …) and formats it. Null means no candle here → skip.
      const value = horzScale.fromLogical(i, buffer);
      if (value === null) continue;

      const label = horzScale.formatValue(value);
      ctx.fillText(label, Math.round(x), Math.round(axisY + TIME_AXIS_LABEL_GAP));
    }
  }
}
