/**
 * C7 — Vector SVG export. A `CanvasRenderingContext2D`-shaped sink that, instead
 * of rasterizing, records the drawing calls as SVG elements. The chart's
 * renderers (candles, line/area, axes, legend, indicators, drawings, …) draw
 * into it exactly as they draw into a real 2D context — so a recognizable,
 * resolution-independent `<svg>` falls out with zero renderer changes.
 *
 * This is the headline advantage over lightweight-charts, which only offers a
 * raster snapshot.
 *
 * ## Scope
 * Implements the subset of the 2D context API the renderers actually call
 * (collected by grepping `ctx.` across `rendering/`, `series/`, `markers/`,
 * `drawings/`, `primitives/`, `indicators/`):
 *
 *   props   fillStyle, strokeStyle, lineWidth, font, textAlign, textBaseline,
 *           globalAlpha, lineJoin, lineCap
 *   path    beginPath, moveTo, lineTo, closePath, rect, arc, quadraticCurveTo
 *   paint   stroke, fill, fillRect, strokeRect, fillText, strokeText, clearRect
 *   state   save, restore, clip, setLineDash
 *   misc    measureText, createLinearGradient, scale, drawImage, getImageData
 *
 * Anything outside that set is a harmless no-op (the renderers never call it),
 * so the shim degrades gracefully rather than throwing if a future renderer
 * reaches for an unimplemented method.
 *
 * ## Fidelity
 * Pragmatic, not pixel-perfect:
 *  - Paths accumulate into one `d` string; `stroke()`/`fill()` emit a `<path>`
 *    snapshotting the *current* style (so a beginPath→…→stroke→…→fill pair
 *    emits two paths, matching canvas semantics).
 *  - `clip()` is applied as the current path's bounding-box rectangle via a
 *    `<clipPath>` referenced by every element emitted until the matching
 *    `restore()` (rectangular clip — the only kind the renderers use).
 *  - `createLinearGradient` registers a `<linearGradient>` in `<defs>`;
 *    assigning it to `fillStyle`/`strokeStyle` makes subsequent fills/strokes
 *    reference it by `url(#…)`.
 *  - HiDPI `scale()` is intentionally ignored: the export works in CSS pixels,
 *    so the SVG `viewBox` is the logical layout size (no DPR multiply).
 *
 * The module is deliberately standalone and is **not** imported by `ChartEngine`
 * or `OHLCVChart`, so it contributes nothing to the tree-shaken base bundle —
 * a host only pays for it when it imports `chartEngineToSVG` / this class.
 */

/** A registered linear gradient (recorded for the `<defs>` block). */
interface GradientRecord {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  stops: { offset: number; color: string }[];
}

/**
 * The object `createLinearGradient` returns. Mirrors the tiny slice of
 * `CanvasGradient` the renderers use (`addColorStop`); carries its `<defs>` id
 * so the shim can resolve a `fillStyle`/`strokeStyle` assignment to `url(#id)`.
 */
class SVGGradient {
  constructor(private readonly _record: GradientRecord) {}
  addColorStop(offset: number, color: string): void {
    this._record.stops.push({ offset, color });
  }
  /** @internal The `<defs>` id used to reference this gradient. */
  get __id(): string {
    return this._record.id;
  }
}

/** A paint value: a CSS color string or a gradient reference. */
type Paint = string | SVGGradient;

/** Snapshot of the mutable drawing state pushed/popped by save()/restore(). */
interface DrawState {
  fillStyle: Paint;
  strokeStyle: Paint;
  lineWidth: number;
  lineJoin: string;
  lineCap: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  globalAlpha: number;
  lineDash: number[];
  /** id of the active `<clipPath>`, or null when unclipped. */
  clipId: string | null;
}

/** Subset of `TextMetrics` the renderers read (`measureText().width`). */
interface SVGTextMetrics {
  width: number;
}

function escapeXML(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Trim trailing zeros from coordinates so the SVG stays compact. */
function num(n: number): string {
  if (!Number.isFinite(n)) return '0';
  // Round to 3 decimals; drop a trailing ".000" / zeros.
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

/** Map canvas `textAlign` to SVG `text-anchor`. */
function textAnchor(align: string): string {
  if (align === 'center') return 'middle';
  if (align === 'right' || align === 'end') return 'end';
  return 'start';
}

/**
 * Map canvas `textBaseline` to an SVG `dominant-baseline`. SVG has no exact
 * equivalent for every canvas baseline; these are the closest renderings and
 * cover the values the renderers use (`top`, `middle`, `bottom`, `alphabetic`).
 */
function dominantBaseline(baseline: string): string | null {
  switch (baseline) {
    case 'top':
      return 'hanging';
    case 'middle':
      return 'central';
    case 'bottom':
      return 'text-after-edge';
    case 'alphabetic':
      return null; // SVG default — omit for a smaller string.
    default:
      return null;
  }
}

/**
 * Approximate the device font size (in px) from a CSS `font` shorthand so
 * `measureText` can estimate a width without a real text-measuring backend.
 * Renderers only need a rough advance to lay out legend/axis labels.
 */
function fontSizePx(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? parseFloat(m[1]!) : 12;
}

export class SVGRenderingContext {
  // Public mutable state, matching the canvas API surface the renderers set.
  fillStyle: Paint = '#000000';
  strokeStyle: Paint = '#000000';
  lineWidth = 1;
  lineJoin = 'miter';
  lineCap = 'butt';
  font = '10px sans-serif';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  globalAlpha = 1;

  /** The owning canvas-like host, if any (some code reads `ctx.canvas`). */
  readonly canvas: { width: number; height: number } | null;

  private _lineDash: number[] = [];
  private _saveStack: DrawState[] = [];

  /** Current path commands accumulated since the last beginPath(). */
  private _path = '';

  /** Emitted SVG body elements, in paint order. */
  private _elements: string[] = [];
  /** `<defs>` entries (clip paths). */
  private _defs: string[] = [];
  /** Registered gradients, emitted into `<defs>` on toSVG(). */
  private _gradients: GradientRecord[] = [];

  private _gradientSeq = 0;
  private _clipSeq = 0;
  /** id of the clip currently in effect (set by clip(), scoped by save/restore). */
  private _clipId: string | null = null;

  constructor(canvas?: { width: number; height: number }) {
    this.canvas = canvas ?? null;
  }

  // --- State stack --------------------------------------------------------

  save(): void {
    this._saveStack.push({
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      lineJoin: this.lineJoin,
      lineCap: this.lineCap,
      font: this.font,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      globalAlpha: this.globalAlpha,
      lineDash: this._lineDash.slice(),
      clipId: this._clipId,
    });
  }

  restore(): void {
    const s = this._saveStack.pop();
    if (!s) return;
    this.fillStyle = s.fillStyle;
    this.strokeStyle = s.strokeStyle;
    this.lineWidth = s.lineWidth;
    this.lineJoin = s.lineJoin;
    this.lineCap = s.lineCap;
    this.font = s.font;
    this.textAlign = s.textAlign;
    this.textBaseline = s.textBaseline;
    this.globalAlpha = s.globalAlpha;
    this._lineDash = s.lineDash;
    this._clipId = s.clipId;
  }

  // --- Path construction --------------------------------------------------

  beginPath(): void {
    this._path = '';
  }

  moveTo(x: number, y: number): void {
    this._path += `M${num(x)} ${num(y)}`;
  }

  lineTo(x: number, y: number): void {
    // Implicit moveTo when a path starts with lineTo (canvas tolerates it).
    this._path += this._path ? `L${num(x)} ${num(y)}` : `M${num(x)} ${num(y)}`;
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this._path += `Q${num(cpx)} ${num(cpy)} ${num(x)} ${num(y)}`;
  }

  arc(x: number, y: number, r: number, startAngle: number, endAngle: number): void {
    // The renderers only draw full-circle markers (0 → 2π). Represent a circle
    // as two arc halves so it closes cleanly regardless of sweep direction.
    const span = Math.abs(endAngle - startAngle);
    if (span >= Math.PI * 2 - 1e-6) {
      const x0 = x - r;
      const x1 = x + r;
      this._path +=
        `M${num(x0)} ${num(y)}` +
        `A${num(r)} ${num(r)} 0 1 1 ${num(x1)} ${num(y)}` +
        `A${num(r)} ${num(r)} 0 1 1 ${num(x0)} ${num(y)}`;
      return;
    }
    // Partial arc fallback: approximate endpoints (rare; renderers use circles).
    const sx = x + r * Math.cos(startAngle);
    const sy = y + r * Math.sin(startAngle);
    const ex = x + r * Math.cos(endAngle);
    const ey = y + r * Math.sin(endAngle);
    const large = span > Math.PI ? 1 : 0;
    this._path += `${this._path ? 'L' : 'M'}${num(sx)} ${num(sy)}` +
      `A${num(r)} ${num(r)} 0 ${large} 1 ${num(ex)} ${num(ey)}`;
  }

  rect(x: number, y: number, w: number, h: number): void {
    this._path +=
      `M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}Z`;
  }

  closePath(): void {
    this._path += 'Z';
  }

  // --- Painting -----------------------------------------------------------

  stroke(): void {
    if (!this._path) return;
    this._emit(
      `<path d="${this._path}" fill="none"` +
        this._strokeAttrs() +
        this._clipAttr() +
        '/>',
    );
  }

  fill(): void {
    if (!this._path) return;
    this._emit(
      `<path d="${this._path}"` +
        this._fillAttrs() +
        this._clipAttr() +
        '/>',
    );
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this._emit(
      `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"` +
        this._fillAttrs() +
        this._clipAttr() +
        '/>',
    );
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this._emit(
      `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="none"` +
        this._strokeAttrs() +
        this._clipAttr() +
        '/>',
    );
  }

  fillText(text: string, x: number, y: number): void {
    if (text === '' || text == null) return;
    const anchor = textAnchor(this.textAlign);
    const baseline = dominantBaseline(this.textBaseline);
    const { family, size, weight, style } = this._parseFont();
    let attrs =
      ` x="${num(x)}" y="${num(y)}"` +
      ` font-family="${escapeXML(family)}" font-size="${num(size)}"`;
    if (weight) attrs += ` font-weight="${escapeXML(weight)}"`;
    if (style) attrs += ` font-style="${escapeXML(style)}"`;
    if (anchor !== 'start') attrs += ` text-anchor="${anchor}"`;
    if (baseline) attrs += ` dominant-baseline="${baseline}"`;
    attrs += this._fillAttrs();
    attrs += this._clipAttr();
    this._emit(`<text${attrs}>${escapeXML(String(text))}</text>`);
  }

  /** Renderers don't stroke text; provided for API completeness (renders as fill). */
  strokeText(text: string, x: number, y: number): void {
    this.fillText(text, x, y);
  }

  clearRect(_x: number, _y: number, _w: number, _h: number): void {
    // No-op: the SVG starts empty and the background is painted by toSVG().
    // (Renderers call clearRect to wipe a layer; there's nothing to wipe here.)
  }

  // --- Clipping -----------------------------------------------------------

  /**
   * Apply the current path's bounding box as a rectangular clip for every
   * element emitted until the matching restore(). The renderers only ever clip
   * to axis-aligned rectangles (chart area / pane bands), so a bbox clip is
   * exact for their usage.
   */
  clip(): void {
    const box = this._pathBBox();
    if (!box) return;
    const id = `clip${this._clipSeq++}`;
    this._defs.push(
      `<clipPath id="${id}"><rect x="${num(box.x)}" y="${num(box.y)}" ` +
        `width="${num(box.w)}" height="${num(box.h)}"/></clipPath>`,
    );
    this._clipId = id;
  }

  // --- Misc / no-ops the renderers may touch ------------------------------

  setLineDash(segments: number[]): void {
    this._lineDash = Array.isArray(segments) ? segments.slice() : [];
  }

  getLineDash(): number[] {
    return this._lineDash.slice();
  }

  measureText(text: string): SVGTextMetrics {
    // Estimate advance width: average glyph ≈ 0.55 em for proportional fonts.
    const size = fontSizePx(this.font);
    return { width: text.length * size * 0.55 };
  }

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): SVGGradient {
    const record: GradientRecord = {
      id: `grad${this._gradientSeq++}`,
      x0,
      y0,
      x1,
      y1,
      stops: [],
    };
    const grad = new SVGGradient(record);
    // Defer emitting until toSVG() so all stops are captured. Stash the record.
    this._gradients.push(record);
    return grad;
  }

  /** HiDPI scale is irrelevant to a vector export (works in CSS px). No-op. */
  scale(_x: number, _y: number): void {}

  /** Raster image blits can't be vectorized; ignored in the SVG output. */
  drawImage(..._args: unknown[]): void {}

  /** Returns a 1×1 transparent stub; renderers only probe `.data` length. */
  getImageData(): { data: Uint8ClampedArray } {
    return { data: new Uint8ClampedArray(4) };
  }

  // --- Output -------------------------------------------------------------

  /**
   * Serialize everything recorded so far into a standalone `<svg>` document
   * string of the given pixel size, with `background` painted as a full-bleed
   * rect underneath the recorded elements.
   */
  toSVG(width: number, height: number, background?: string): string {
    const w = num(width);
    const h = num(height);
    const parts: string[] = [];
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
        `viewBox="0 0 ${w} ${h}">`,
    );

    const defs = this._buildDefs();
    if (defs) parts.push(`<defs>${defs}</defs>`);

    if (background) {
      parts.push(
        `<rect x="0" y="0" width="${w}" height="${h}" fill="${escapeXML(background)}"/>`,
      );
    }

    for (const el of this._elements) parts.push(el);
    parts.push('</svg>');
    return parts.join('');
  }

  // --- Internals ----------------------------------------------------------

  private _emit(el: string): void {
    this._elements.push(el);
  }

  private _buildDefs(): string {
    const out: string[] = [];
    for (const g of this._gradients) {
      const stops = g.stops
        .map(
          (s) =>
            `<stop offset="${num(s.offset)}" stop-color="${escapeXML(s.color)}"/>`,
        )
        .join('');
      out.push(
        `<linearGradient id="${g.id}" gradientUnits="userSpaceOnUse" ` +
          `x1="${num(g.x0)}" y1="${num(g.y0)}" x2="${num(g.x1)}" y2="${num(g.y1)}">` +
          stops +
          `</linearGradient>`,
      );
    }
    // Clip paths were already pushed into _defs as they were created.
    out.push(...this._defs);
    return out.join('');
  }

  /** Resolve a Paint to an SVG attribute value (`url(#id)` or a color). */
  private _paintValue(paint: Paint): string {
    if (paint instanceof SVGGradient) return `url(#${paint.__id})`;
    return escapeXML(paint);
  }

  private _fillAttrs(): string {
    let s = ` fill="${this._paintValue(this.fillStyle)}"`;
    if (this.globalAlpha < 1) s += ` fill-opacity="${num(this.globalAlpha)}"`;
    return s;
  }

  private _strokeAttrs(): string {
    let s =
      ` stroke="${this._paintValue(this.strokeStyle)}"` +
      ` stroke-width="${num(this.lineWidth)}"`;
    if (this.lineJoin && this.lineJoin !== 'miter') s += ` stroke-linejoin="${this.lineJoin}"`;
    if (this.lineCap && this.lineCap !== 'butt') s += ` stroke-linecap="${this.lineCap}"`;
    if (this._lineDash.length > 0) {
      s += ` stroke-dasharray="${this._lineDash.map(num).join(',')}"`;
    }
    if (this.globalAlpha < 1) s += ` stroke-opacity="${num(this.globalAlpha)}"`;
    return s;
  }

  private _clipAttr(): string {
    return this._clipId ? ` clip-path="url(#${this._clipId})"` : '';
  }

  /**
   * Bounding box of the current path. Scans the numeric operands in the
   * accumulated `d` string — sufficient because every clip path the renderers
   * build is a single axis-aligned `rect(...)`, whose 4 corner coordinates
   * fully determine the box.
   */
  private _pathBBox(): { x: number; y: number; w: number; h: number } | null {
    // Fast path: the rect() form `M x y h w v hh ...` — the only shape the
    // renderers clip to. Reconstruct the box directly from M + h + v operands.
    const rectMatch =
      /^M(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)h(-?\d+(?:\.\d+)?)v(-?\d+(?:\.\d+)?)/.exec(
        this._path,
      );
    if (rectMatch) {
      const x = parseFloat(rectMatch[1]!);
      const y = parseFloat(rectMatch[2]!);
      const w = parseFloat(rectMatch[3]!);
      const hh = parseFloat(rectMatch[4]!);
      return {
        x: Math.min(x, x + w),
        y: Math.min(y, y + hh),
        w: Math.abs(w),
        h: Math.abs(hh),
      };
    }
    // Generic fallback: treat consecutive numbers in `d` as x,y pairs and take
    // their extent. Over-approximates for curves but is exact for the
    // axis-aligned polylines the renderers actually clip against.
    const coords = this._path.match(/-?\d+(?:\.\d+)?/g);
    if (!coords || coords.length < 2) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i + 1 < coords.length; i += 2) {
      const px = parseFloat(coords[i]!);
      const py = parseFloat(coords[i + 1]!);
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /** Split the CSS `font` shorthand into family / size / weight / style. */
  private _parseFont(): { family: string; size: number; weight: string | null; style: string | null } {
    const font = this.font || '10px sans-serif';
    const size = fontSizePx(font);
    let weight: string | null = null;
    let style: string | null = null;
    if (/\bbold\b/.test(font) || /\b[5-9]00\b/.test(font)) weight = 'bold';
    if (/\bitalic\b/.test(font)) style = 'italic';
    // Family: take the substring after the size token.
    const sizeIdx = font.search(/\d+(?:\.\d+)?px/);
    let family = 'sans-serif';
    if (sizeIdx >= 0) {
      const after = font.slice(sizeIdx).replace(/^\d+(?:\.\d+)?px\s*/, '').trim();
      if (after) family = after;
    }
    return { family, size, weight, style };
  }
}
