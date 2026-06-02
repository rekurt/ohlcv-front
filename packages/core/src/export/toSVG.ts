import type { ChartEngine } from '../rendering/ChartEngine';
import { SVGRenderingContext } from './svgContext';

/**
 * C7 — render a {@link ChartEngine}'s current chart layer to a **vector** SVG
 * string. Unlike `ChartEngine.toPNG()` (a raster snapshot), this produces a
 * resolution-independent document the host can embed, download, or post-process
 * — the headline advantage over lightweight-charts, which has no SVG export.
 *
 * How it works: a {@link SVGRenderingContext} (a 2D-context-shaped recorder) is
 * passed to the engine's {@link ChartEngine.renderToContext} seam, which runs
 * the exact same geometry + paint pipeline as an on-screen frame but draws into
 * the recorder instead of a canvas. The recorded elements are then serialized
 * at the engine's logical layout size, over a backdrop matching the theme.
 *
 * Lives in its own module and is **not** imported by `ChartEngine` or
 * `OHLCVChart`, so it adds nothing to the tree-shaken base bundle: a host pays
 * for the SVG shim only when it imports this function.
 *
 * The chart-layer content (grid, volume, candles/line/area, overlay + pane
 * indicators, markers, drawings, primitives, axes) is included. The UI layer
 * (legend, live-price pill, "go to live") and the crosshair are intentionally
 * excluded — they're transient on-screen affordances, not part of an exported
 * picture, mirroring how `renderToContext` only paints the chart layer.
 *
 * @returns A standalone `<svg …>…</svg>` string. When the engine has no buffer
 * set, the recorder stays empty and the result is just the sized background
 * rect inside an otherwise-empty `<svg>` (valid, non-throwing).
 */
export function chartEngineToSVG(engine: ChartEngine): string {
  const { width, height } = engine.layout;
  const ctx = new SVGRenderingContext({ width, height });
  // The recorder implements the subset of CanvasRenderingContext2D the
  // renderers use; the cast is the deliberate duck-typed seam between the
  // canvas-typed render path and the SVG sink.
  engine.renderToContext(ctx as unknown as CanvasRenderingContext2D);
  return ctx.toSVG(width, height, engine.themeBackground);
}
