import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';
import type { CandleBuffer } from '../data/CandleBuffer';
import { MARKER_SIZE, MARKER_GAP, MARKER_FONT } from '../constants';
import { markerY, type Marker } from './Marker';

/**
 * Renders point markers anchored to candles by timestamp. Markers whose
 * candle isn't in the buffer (not yet loaded, or evicted) are skipped.
 * Drawn on the chart layer so they pan/zoom with the data and appear in
 * `toPNG()`.
 */
export class MarkerRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    buffer: CandleBuffer,
    markers: readonly Marker[],
    theme: ThemeColors,
    /** Highest revealed index (replay cap). Markers past it are hidden. */
    maxIndex = Infinity,
  ): void {
    if (markers.length === 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(
      layout.chartLeft,
      layout.chartTop,
      layout.chartRight - layout.chartLeft,
      layout.chartBottom - layout.chartTop,
    );
    ctx.clip();
    ctx.font = MARKER_FONT;
    ctx.textBaseline = 'middle';

    for (const marker of markers) {
      const index = buffer.findIndexByTime(marker.time);
      if (index === -1 || index > maxIndex) continue;
      const candle = buffer.candleAt(index);
      if (!candle) continue;

      const x = viewport.indexToX(index);
      if (x < layout.chartLeft || x > layout.chartRight) continue;

      const size = marker.size ?? MARKER_SIZE;
      const y = markerY(marker, candle, viewport, MARKER_GAP, size);
      const color = marker.color ?? theme.text;

      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      this._drawGlyph(ctx, marker.shape ?? 'circle', x, y, size);

      if (marker.text) {
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.fillText(marker.text, x + size, y);
      }
    }

    ctx.restore();
  }

  private _drawGlyph(
    ctx: CanvasRenderingContext2D,
    shape: Marker['shape'],
    x: number,
    y: number,
    size: number,
  ): void {
    const h = size / 2;
    switch (shape) {
      case 'arrowUp':
        ctx.beginPath();
        ctx.moveTo(x, y - h);
        ctx.lineTo(x + h, y + h);
        ctx.lineTo(x - h, y + h);
        ctx.closePath();
        ctx.fill();
        break;
      case 'arrowDown':
        ctx.beginPath();
        ctx.moveTo(x, y + h);
        ctx.lineTo(x + h, y - h);
        ctx.lineTo(x - h, y - h);
        ctx.closePath();
        ctx.fill();
        break;
      case 'square':
        ctx.fillRect(x - h, y - h, size, size);
        break;
      case 'flag':
        ctx.beginPath();
        ctx.moveTo(x - h, y - h);
        ctx.lineTo(x + h, y);
        ctx.lineTo(x - h, y + h * 0.2);
        ctx.closePath();
        ctx.fill();
        // Pole.
        ctx.beginPath();
        ctx.moveTo(x - h + 0.5, y - h);
        ctx.lineTo(x - h + 0.5, y + h);
        ctx.stroke();
        break;
      case 'circle':
      default:
        ctx.beginPath();
        ctx.arc(x, y, h, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
  }
}
