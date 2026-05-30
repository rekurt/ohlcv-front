import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';

/**
 * Z-tier a primitive paints in, relative to the chart's fixed paint order:
 *  - `'bottom'` — behind the grid and series (watermarks, session bands)
 *  - `'normal'` — with the drawing layer, above series/indicators
 *  - `'top'`    — above everything on the UI layer (price lines + their pills)
 */
export type PrimitiveZOrder = 'bottom' | 'normal' | 'top';

/**
 * A programmatic, host-driven overlay drawn at an explicit z-tier.
 *
 * Distinct from {@link Drawing}: drawings are user-created interactive tools
 * with undo/redo, snapshot persistence, selection handles, and a creation
 * FSM, anchored in buffer space. Primitives are imperative overlays the host
 * attaches/detaches directly (watermark, price lines, custom bands) — no
 * undo, no persistence, just a draw at a chosen tier. The two deliberately
 * share the `draw`/`hitTest` shape so rendering helpers can be reused.
 *
 * `draw` receives the same coordinate transforms as everything else
 * (`viewport.priceToY`/`indexToX`), so primitives inherit price-scale-mode
 * correctness (F1) for free.
 */
export interface Primitive {
  /** Stable id used for detach and hit-test routing. */
  readonly id: string;
  /** Paint tier. */
  zOrder: PrimitiveZOrder;
  /**
   * Paint the primitive. Should self-clip if it must stay inside the chart.
   * `priceFormat` is the chart's host-supplied price formatter (from
   * `ChartConfig.priceFormat`), so primitives that render a price label
   * (e.g. price lines) match the axis/crosshair formatting instead of
   * falling back to the library default.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    theme: ThemeColors,
    priceFormat?: (price: number) => string,
  ): void;
  /**
   * Optional pointer hit-test in CSS pixels. Used to route drags (e.g. a
   * draggable price line). Return true if (x, y) lands on the primitive.
   */
  hitTest?(
    x: number,
    y: number,
    layout: ChartLayout,
    viewport: Viewport,
    tolerance?: number,
  ): boolean;
}

/**
 * Clip the context to the chart price area. Helper for primitives that must
 * not paint over the axes. Call inside a `ctx.save()` / `ctx.restore()` pair.
 */
export function clipToChart(ctx: CanvasRenderingContext2D, layout: ChartLayout): void {
  ctx.beginPath();
  ctx.rect(
    layout.chartLeft,
    layout.chartTop,
    layout.chartRight - layout.chartLeft,
    layout.chartBottom - layout.chartTop,
  );
  ctx.clip();
}
