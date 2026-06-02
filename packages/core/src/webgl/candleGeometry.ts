import type { ThemeColors, ChartLayout, CandleView } from '../types';
import { WICK_WIDTH, MIN_CANDLE_BODY_HEIGHT } from '../constants';
import type { Viewport } from '../interaction/Viewport';

/**
 * Vertex buffers for one frame of candles, ready to be uploaded straight to
 * a WebGL `ARRAY_BUFFER`. Both arrays are tightly packed and parallel —
 * `positions[2*v], positions[2*v+1]` is vertex `v`'s (x, y) in PIXELS, and
 * `colors[3*v .. 3*v+2]` is the same vertex's RGB in the 0..1 range.
 *
 * `vertexCount` is the number of vertices (not floats); pass it directly to
 * `gl.drawArrays(gl.TRIANGLES, 0, vertexCount)`.
 */
export interface CandleVertexData {
  positions: Float32Array;
  colors: Float32Array;
  vertexCount: number;
}

/** Vertices per candle: a body quad (6) + a wick quad (6). */
const VERTS_PER_CANDLE = 12;

/**
 * Parse a `#rrggbb` / `#rgb` / `rgb(...)` / `rgba(...)` color into normalized
 * 0..1 RGB for a GL vertex attribute. Mirrors the parsing in
 * {@link colorWithAlpha} / {@link withAlpha} but emits floats instead of an
 * `rgba()` string, since shaders consume linearized 0..1 channels. Unknown
 * formats fall back to black — a theme should always supply hex/rgb candle
 * colors, so this only guards against a typo rather than papering over one.
 */
function parseColor01(color: string): [number, number, number] {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    const hex =
      color.length === 4
        ? color
            .slice(1)
            .split('')
            .map((c) => c + c)
            .join('')
        : color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return [r / 255, g / 255, b / 255];
  }
  const rgbaMatch = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbaMatch) {
    return [Number(rgbaMatch[1]) / 255, Number(rgbaMatch[2]) / 255, Number(rgbaMatch[3]) / 255];
  }
  return [0, 0, 0];
}

/**
 * Append the six vertices (two triangles) of an axis-aligned rectangle, given
 * its left/right/top/bottom pixel edges and a flat RGB color, into the
 * positions/colors arrays at write cursor `base` (a vertex index). Returns the
 * next free vertex index. The triangle winding is (TL, BL, BR) + (TL, BR, TR)
 * — winding is irrelevant here because the fragment shader does no face
 * culling, but keeping it consistent makes the geometry easy to reason about.
 */
function pushRect(
  positions: Float32Array,
  colors: Float32Array,
  base: number,
  left: number,
  right: number,
  top: number,
  bottom: number,
  rgb: readonly [number, number, number],
): number {
  // Six (x, y) corners: TL, BL, BR, TL, BR, TR.
  const xs = [left, left, right, left, right, right];
  const ys = [top, bottom, bottom, top, bottom, top];
  let p = base * 2;
  let c = base * 3;
  for (let k = 0; k < 6; k++) {
    positions[p++] = xs[k]!;
    positions[p++] = ys[k]!;
    colors[c++] = rgb[0];
    colors[c++] = rgb[1];
    colors[c++] = rgb[2];
  }
  return base + 6;
}

/**
 * Build per-candle triangle geometry for the visible portion of `view`, in the
 * exact same screen space the Canvas2D {@link CandleRenderer} draws into — so a
 * WebGL pass is pixel-equivalent to the 2D pass it replaces.
 *
 * PURE: takes no GL context and touches no DOM, so it is fully unit-testable in
 * jsdom. The {@link WebGLCandleRenderer} calls this each frame and uploads the
 * result; a host can also call it directly to feed a custom GL pipeline.
 *
 * For every visible candle two quads are emitted — a thin {@link WICK_WIDTH}
 * wick from `priceToY(high)` to `priceToY(low)`, and a body from
 * `priceToY(max(open,close))` to `priceToY(min(open,close))` floored to
 * {@link MIN_CANDLE_BODY_HEIGHT} (so a doji stays visible) — giving
 * `VERTS_PER_CANDLE` (12) vertices. Candles whose body lies entirely left of
 * `layout.chartLeft` or right of `layout.chartRight` are culled and contribute
 * nothing, matching the 2D renderer's skip test. Conflated (downsampled) views
 * are positioned via `repIndex[i]` and their body is widened to ≥ 1px, again
 * matching {@link CandleRenderer}.
 *
 * Color is per-vertex: a bullish candle (`close >= open`) uses
 * `theme.bullCandle`, otherwise `theme.bearCandle`, each parsed to 0..1 RGB.
 */
export function buildCandleVertices(
  view: CandleView,
  viewport: Viewport,
  layout: ChartLayout,
  theme: ThemeColors,
): CandleVertexData {
  // Conflated views (sub-pixel candles collapsed to one bar per pixel column)
  // widen to at least 1px so the downsampled bars stay visible — identical to
  // CandleRenderer.
  const bodyWidth = view.repIndex ? Math.max(1, viewport.candleWidth) : viewport.candleWidth;
  const halfBody = bodyWidth / 2;

  const bull = parseColor01(theme.bullCandle);
  const bear = parseColor01(theme.bearCandle);

  // Worst case every candle is visible → preallocate the full buffers once and
  // track the real vertex count via the write cursor (culled candles simply
  // leave the tail unused, then we subarray down to the exact length so
  // bufferData/drawArrays never touch stale slots).
  const maxVerts = view.length * VERTS_PER_CANDLE;
  const positions = new Float32Array(maxVerts * 2);
  const colors = new Float32Array(maxVerts * 3);

  let v = 0; // write cursor, in vertices
  for (let i = 0; i < view.length; i++) {
    const open = view.open[i]!;
    const close = view.close[i]!;

    const bufferIndex = view.repIndex ? view.repIndex[i]! : view.offset + i;
    const x = viewport.indexToX(bufferIndex);

    // Skip if the body is fully outside the visible area (same test as 2D).
    if (x + halfBody < layout.chartLeft || x - halfBody > layout.chartRight) continue;

    const isBull = close >= open;
    const rgb = isBull ? bull : bear;

    const high = view.high[i]!;
    const low = view.low[i]!;

    // Wick: a WICK_WIDTH-wide column centered on the (rounded) candle X,
    // spanning high→low. Matches CandleRenderer's `Math.round(x) - WICK_WIDTH/2`.
    const wickLeft = Math.round(x) - WICK_WIDTH / 2;
    const wickTop = viewport.priceToY(high);
    const wickBottom = viewport.priceToY(low);
    v = pushRect(positions, colors, v, wickLeft, wickLeft + WICK_WIDTH, wickTop, wickBottom, rgb);

    // Body: open..close, floored to MIN_CANDLE_BODY_HEIGHT. Left edge rounded
    // exactly as the 2D path (`Math.round(x - halfBody)`).
    const bodyTop = viewport.priceToY(Math.max(open, close));
    const bodyBottom = viewport.priceToY(Math.min(open, close));
    const bodyHeight = Math.max(MIN_CANDLE_BODY_HEIGHT, bodyBottom - bodyTop);
    const bodyLeft = Math.round(x - halfBody);
    v = pushRect(positions, colors, v, bodyLeft, bodyLeft + bodyWidth, bodyTop, bodyTop + bodyHeight, rgb);
  }

  // Trim to the vertices actually written so consumers can upload/draw the
  // exact slice (subarray is a zero-copy view — no extra allocation).
  if (v === maxVerts) {
    return { positions, colors, vertexCount: v };
  }
  return {
    positions: positions.subarray(0, v * 2),
    colors: colors.subarray(0, v * 3),
    vertexCount: v,
  };
}
