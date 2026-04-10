import type { ChartLayout, ThemeColors } from '../types';

export interface GoToLiveBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Floating "Go to live ▶" pill that appears in the lower-right corner of the
 * chart area when the viewport is not following the live edge. Clicking it
 * scrolls the chart to the newest candle and re-enables auto-follow.
 *
 * The renderer draws into any CanvasRenderingContext2D and returns the pill's
 * bounding box in logical pixels so the controller can hit-test clicks.
 */
export class GoToLiveRenderer {
  private _lastBounds: GoToLiveBounds | null = null;

  /** Returns the last-rendered pill bounds, or null if the pill is hidden. */
  getBounds(): GoToLiveBounds | null {
    return this._lastBounds;
  }

  hide(): void {
    this._lastBounds = null;
  }

  render(ctx: CanvasRenderingContext2D, layout: ChartLayout, theme: ThemeColors): void {
    const label = 'Go to live ▶';
    const paddingX = 12;
    const paddingY = 6;
    const fontSize = 12;

    ctx.save();
    ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    const textWidth = ctx.measureText(label).width;
    const width = textWidth + paddingX * 2;
    const height = fontSize + paddingY * 2;

    // Positioned in the bottom-right corner of the chart area, above the
    // time axis and just inside the price axis.
    const x = layout.chartRight - width - 12;
    const y = layout.chartBottom - height - 12;

    // Pill background — filled accent with rounded corners.
    const radius = height / 2;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();

    ctx.fillStyle = theme.bullCandle;
    ctx.fill();
    ctx.strokeStyle = theme.background;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Label — white text regardless of theme, matching the highlight pill.
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + width / 2, y + height / 2);

    ctx.restore();

    this._lastBounds = { x, y, width, height };
  }

  /** Hit-test a pointer event in logical chart coordinates. */
  hitTest(localX: number, localY: number): boolean {
    const b = this._lastBounds;
    if (!b) return false;
    return localX >= b.x && localX <= b.x + b.width && localY >= b.y && localY <= b.y + b.height;
  }
}
