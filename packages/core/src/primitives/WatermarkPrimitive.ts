import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';
import type { Primitive, PrimitiveZOrder } from './Primitive';

export type WatermarkPosition =
  | 'center'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight';

export interface WatermarkOptions {
  /** Text watermark (e.g. symbol + timeframe). Ignored if `image` is set. */
  text?: string;
  /** Image watermark (logo). Takes precedence over `text`. */
  image?: CanvasImageSource;
  /** Anchor within the chart area. Default `'center'`. */
  position?: WatermarkPosition;
  /** 0..1 opacity. Default `0.1`. */
  opacity?: number;
  /** Font size in px for text watermarks. Default `48`. */
  fontSize?: number;
  /** Color for text watermarks. Defaults to the theme text color. */
  color?: string;
}

/** Inset (px) from the chart edges for corner-anchored watermarks. */
const WATERMARK_PAD = 16;

/**
 * A `'bottom'` z-tier {@link Primitive} that paints a faint text or image
 * watermark behind the grid and series. Pure consumer of the Primitives
 * framework — it needs zero ChartEngine changes, which is what validates F4.
 */
export class WatermarkPrimitive implements Primitive {
  readonly id: string;
  readonly zOrder: PrimitiveZOrder = 'bottom';
  private _opts: WatermarkOptions;

  constructor(id: string, options: WatermarkOptions) {
    this.id = id;
    this._opts = options;
  }

  setOptions(options: WatermarkOptions): void {
    this._opts = options;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    _viewport: Viewport,
    theme: ThemeColors,
  ): void {
    const opts = this._opts;
    const opacity = clamp01(opts.opacity ?? 0.1);
    if (opacity <= 0) return;

    ctx.save();
    ctx.globalAlpha = opacity;

    if (opts.image) {
      this._drawImage(ctx, layout, opts.image, opts.position ?? 'center');
    } else if (opts.text) {
      this._drawText(ctx, layout, theme, opts);
    }

    ctx.restore();
  }

  private _drawText(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    theme: ThemeColors,
    opts: WatermarkOptions,
  ): void {
    const fontSize = opts.fontSize ?? 48;
    ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    ctx.fillStyle = opts.color ?? theme.text;
    const pos = opts.position ?? 'center';
    const { x, align } = horizontalAnchor(layout, pos);
    const { y, baseline } = verticalAnchor(layout, pos);
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(opts.text ?? '', x, y);
  }

  private _drawImage(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    image: CanvasImageSource,
    pos: WatermarkPosition,
  ): void {
    // An HTMLImageElement that hasn't finished loading throws in drawImage on
    // some engines — skip until it's ready.
    if ('complete' in image && (image as HTMLImageElement).complete === false) return;

    const w = imageWidth(image);
    const h = imageHeight(image);
    if (w <= 0 || h <= 0) return;

    let x = layout.chartLeft + WATERMARK_PAD;
    let y = layout.chartTop + WATERMARK_PAD;
    if (pos === 'center') {
      x = (layout.chartLeft + layout.chartRight) / 2 - w / 2;
      y = (layout.chartTop + layout.chartBottom) / 2 - h / 2;
    } else {
      if (pos === 'topRight' || pos === 'bottomRight') x = layout.chartRight - WATERMARK_PAD - w;
      if (pos === 'bottomLeft' || pos === 'bottomRight') y = layout.chartBottom - WATERMARK_PAD - h;
    }
    try {
      ctx.drawImage(image, x, y);
    } catch {
      // Ignore broken/incomplete image sources rather than crashing the frame.
    }
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function horizontalAnchor(
  layout: ChartLayout,
  pos: WatermarkPosition,
): { x: number; align: CanvasTextAlign } {
  switch (pos) {
    case 'topLeft':
    case 'bottomLeft':
      return { x: layout.chartLeft + WATERMARK_PAD, align: 'left' };
    case 'topRight':
    case 'bottomRight':
      return { x: layout.chartRight - WATERMARK_PAD, align: 'right' };
    case 'center':
    default:
      return { x: (layout.chartLeft + layout.chartRight) / 2, align: 'center' };
  }
}

function verticalAnchor(
  layout: ChartLayout,
  pos: WatermarkPosition,
): { y: number; baseline: CanvasTextBaseline } {
  switch (pos) {
    case 'topLeft':
    case 'topRight':
      return { y: layout.chartTop + WATERMARK_PAD, baseline: 'top' };
    case 'bottomLeft':
    case 'bottomRight':
      return { y: layout.chartBottom - WATERMARK_PAD, baseline: 'bottom' };
    case 'center':
    default:
      return { y: (layout.chartTop + layout.chartBottom) / 2, baseline: 'middle' };
  }
}

function imageWidth(image: CanvasImageSource): number {
  const anyImg = image as { width?: number; naturalWidth?: number; videoWidth?: number };
  return anyImg.naturalWidth ?? anyImg.width ?? anyImg.videoWidth ?? 0;
}
function imageHeight(image: CanvasImageSource): number {
  const anyImg = image as { height?: number; naturalHeight?: number; videoHeight?: number };
  return anyImg.naturalHeight ?? anyImg.height ?? anyImg.videoHeight ?? 0;
}
