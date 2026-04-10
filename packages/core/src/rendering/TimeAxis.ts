import type { ThemeColors, ChartLayout } from '../types';
import { formatTime } from '../utils';
import type { Viewport } from '../interaction/Viewport';
import type { CandleBuffer } from '../data/CandleBuffer';
import { AXIS_FONT, TIME_AXIS_LABEL_GAP } from '../constants';

export class TimeAxisRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    buffer: CandleBuffer,
    resolution: string,
    theme: ThemeColors,
  ): void {
    const axisY = layout.chartBottom;

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

      const candle = buffer.candleAt(i);
      if (!candle) continue;

      const label = formatTime(candle.t, resolution);
      ctx.fillText(label, x, axisY + TIME_AXIS_LABEL_GAP);
    }
  }
}
