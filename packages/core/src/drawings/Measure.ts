import { Drawing, type AnchorPoint } from './Drawing';
import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';
import { DRAWING_HIT_TOLERANCE_PX } from '../constants';
import { colorWithAlpha } from './geometry';
import { formatPrice } from '../utils';

/**
 * Measure tool — two anchor points marking a rectangular region. Renders
 * the box plus a centered readout of:
 *   • the signed price delta (B.price − A.price), via the chart's
 *     scale-aware price formatter,
 *   • that delta as a percentage of the start price,
 *   • the number of bars spanned (|round(B.index) − round(A.index)|).
 *
 * The fill/stroke is tinted green when price rose A→B and red when it
 * fell (using the theme's bull/bear colors), matching the familiar
 * "ruler" gesture from trading terminals. An explicit `color` override,
 * when set, wins over the directional tint.
 */
export class Measure extends Drawing {
  static readonly KIND = 'measure';

  get kind(): string {
    return Measure.KIND;
  }
  get requiredPoints(): number {
    return 2;
  }

  override render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    theme: ThemeColors,
  ): void {
    if (this.points.length < 2) return;
    const [a, b] = this.points as [AnchorPoint, AnchorPoint];

    const x1 = viewport.indexToX(a.index);
    const y1 = viewport.priceToY(a.price);
    const x2 = viewport.indexToX(b.index);
    const y2 = viewport.priceToY(b.price);
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);

    const up = b.price >= a.price;
    const base = this.color ?? (up ? theme.bullCandle : theme.bearCandle);

    ctx.save();
    ctx.beginPath();
    ctx.rect(
      layout.chartLeft,
      layout.chartTop,
      layout.chartRight - layout.chartLeft,
      layout.chartBottom - layout.chartTop,
    );
    ctx.clip();

    ctx.fillStyle = colorWithAlpha(base, 0.12);
    ctx.fillRect(left, top, w, h);
    ctx.strokeStyle = base;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(left + 0.5, top + 0.5, w, h);

    // Readout.
    const delta = b.price - a.price;
    const pct = a.price !== 0 ? (delta / Math.abs(a.price)) * 100 : 0;
    const bars = Math.abs(Math.round(b.index) - Math.round(a.index));
    const sign = delta > 0 ? '+' : '';
    const priceLabel =
      viewport.formatPriceLabel(delta) ?? `${sign}${formatPrice(delta)}`;
    const line1 = `${priceLabel} (${sign}${pct.toFixed(2)}%)`;
    const line2 = `${bars} ${bars === 1 ? 'bar' : 'bars'}`;

    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = left + w / 2;
    const cy = top + h / 2;
    const tw = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width);
    const padX = 6;
    const padY = 4;
    const lineH = 14;
    const boxW = tw + padX * 2;
    const boxH = lineH * 2 + padY * 2;

    ctx.fillStyle = colorWithAlpha(base, 0.9);
    ctx.fillRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(line1, cx, cy - lineH / 2);
    ctx.fillText(line2, cx, cy + lineH / 2);

    ctx.restore();
  }

  override hitTest(
    px: number,
    py: number,
    layout: ChartLayout,
    viewport: Viewport,
    tolerance: number = DRAWING_HIT_TOLERANCE_PX,
  ): boolean {
    if (this.points.length < 2) return false;
    if (px < layout.chartLeft || px > layout.chartRight) return false;
    if (py < layout.chartTop || py > layout.chartBottom) return false;
    const [a, b] = this.points as [AnchorPoint, AnchorPoint];
    const x1 = viewport.indexToX(a.index);
    const y1 = viewport.priceToY(a.price);
    const x2 = viewport.indexToX(b.index);
    const y2 = viewport.priceToY(b.price);
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    return (
      px >= left - tolerance &&
      px <= right + tolerance &&
      py >= top - tolerance &&
      py <= bottom + tolerance
    );
  }
}
