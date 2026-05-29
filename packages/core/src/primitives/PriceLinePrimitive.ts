import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';
import {
  AXIS_FONT,
  AXIS_LABEL_HEIGHT,
  AXIS_LABEL_BG_INSET,
  AXIS_LABEL_TEXT_PAD,
  DRAWING_HIT_TOLERANCE_PX,
} from '../constants';
import { formatPrice } from '../utils';
import type { Primitive, PrimitiveZOrder } from './Primitive';

export interface PriceLineOptions {
  /** Price the line sits at. */
  price: number;
  /** Line + pill color. Defaults to the theme text color. */
  color?: string;
  /** Pill label. Defaults to the formatted price. */
  title?: string;
  /** `'solid'` or `'dashed'` (default). */
  lineStyle?: 'solid' | 'dashed';
  /** When true, the user can drag the line vertically to change its price. */
  draggable?: boolean;
}

/** Live handle returned by `OHLCVChart.createPriceLine`. */
export interface PriceLineHandle {
  readonly id: string;
  /** Move the line to a new price. */
  setPrice(price: number): void;
  /** Read the current price. */
  getPrice(): number;
  /** Update color/title/lineStyle/draggable. */
  setOptions(options: Partial<Omit<PriceLineOptions, 'price'>>): void;
  /** Remove the line from the chart. */
  remove(): void;
}

/**
 * A `'top'` z-tier {@link Primitive}: a full-width horizontal line at a fixed
 * price with a right-axis label pill, optionally draggable. Built on the F4
 * framework; positions via `viewport.priceToY` so it stays correct under any
 * price-scale mode (F1).
 *
 * Distinct from the `HorizontalLine` drawing tool — this is programmatic
 * (created/updated by the host via a handle), not an interactive,
 * undo/redo-tracked, persisted drawing.
 */
export class PriceLinePrimitive implements Primitive {
  readonly id: string;
  readonly zOrder: PrimitiveZOrder = 'top';
  private _price: number;
  private _options: Omit<PriceLineOptions, 'price'>;

  constructor(id: string, options: PriceLineOptions) {
    this.id = id;
    this._price = options.price;
    const { price: _price, ...rest } = options;
    void _price;
    this._options = rest;
  }

  get price(): number {
    return this._price;
  }

  get draggable(): boolean {
    return this._options.draggable === true;
  }

  setPrice(price: number): void {
    this._price = price;
  }

  setOptions(options: Partial<Omit<PriceLineOptions, 'price'>>): void {
    this._options = { ...this._options, ...options };
  }

  draw(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    theme: ThemeColors,
  ): void {
    const y = viewport.priceToY(this._price);
    if (y < layout.chartTop || y > layout.chartBottom) return;
    const color = this._options.color ?? theme.text;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    if (this._options.lineStyle !== 'solid') ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(layout.chartLeft, Math.round(y) + 0.5);
    ctx.lineTo(layout.chartRight, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    // Right-axis label pill.
    const label = this._options.title ?? formatPrice(this._price);
    const pillWidth = layout.priceAxisWidth - AXIS_LABEL_BG_INSET * 2;
    ctx.fillStyle = color;
    ctx.fillRect(
      layout.chartRight + AXIS_LABEL_BG_INSET,
      y - AXIS_LABEL_HEIGHT / 2,
      pillWidth,
      AXIS_LABEL_HEIGHT,
    );
    ctx.fillStyle = '#ffffff';
    ctx.font = AXIS_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, layout.chartRight + AXIS_LABEL_TEXT_PAD, y);
    ctx.restore();
  }

  hitTest(
    x: number,
    y: number,
    layout: ChartLayout,
    viewport: Viewport,
    tolerance: number = DRAWING_HIT_TOLERANCE_PX,
  ): boolean {
    // Only the in-chart span is grabbable, so a drag starting in the
    // price-axis strip still rescales the axis.
    if (x < layout.chartLeft || x > layout.chartRight) return false;
    const ly = viewport.priceToY(this._price);
    if (ly < layout.chartTop || ly > layout.chartBottom) return false;
    return Math.abs(y - ly) <= tolerance;
  }
}
