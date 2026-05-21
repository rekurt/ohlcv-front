import type { Drawing, DrawingSnapshot, AnchorPoint } from './Drawing';
import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';
import { DRAWING_HANDLE_PX, DRAWING_HIT_TOLERANCE_PX } from '../constants';
import { TrendLine } from './TrendLine';
import { HorizontalLine } from './HorizontalLine';
import { Rectangle } from './Rectangle';
import { Ray } from './Ray';
import { VerticalLine } from './VerticalLine';
import { FibRetracement } from './FibRetracement';
import { FibExtension } from './FibExtension';
import { Channel } from './Channel';
import { Arrow } from './Arrow';

/**
 * Factory that resurrects a Drawing from its serialized snapshot.
 * Consumers can register additional subclasses via `registerKind`.
 */
type DrawingFactory = (snapshot: DrawingSnapshot) => Drawing;

const FACTORIES: Map<string, DrawingFactory> = new Map();

function hydrate<T extends Drawing>(ctor: new (id?: string) => T): DrawingFactory {
  return (snap: DrawingSnapshot) => {
    const d = new ctor(snap.id);
    for (const p of snap.points) d.addPoint({ ...p });
    if (snap.color !== undefined) d.color = snap.color;
    return d;
  };
}

FACTORIES.set(TrendLine.KIND, hydrate(TrendLine));
FACTORIES.set(HorizontalLine.KIND, hydrate(HorizontalLine));
FACTORIES.set(Rectangle.KIND, hydrate(Rectangle));
FACTORIES.set(Ray.KIND, hydrate(Ray));
FACTORIES.set(VerticalLine.KIND, hydrate(VerticalLine));
FACTORIES.set(FibRetracement.KIND, hydrate(FibRetracement));
FACTORIES.set(FibExtension.KIND, hydrate(FibExtension));
FACTORIES.set(Channel.KIND, hydrate(Channel));
FACTORIES.set(Arrow.KIND, hydrate(Arrow));

/**
 * Ordered collection of drawings with a single "active" slot for
 * creation in progress. Consumers drive creation via `startDrawing`,
 * `addPoint`, and an implicit finalize when the drawing hits its
 * required point count.
 *
 * The layer is render-only with respect to the chart — it doesn't
 * listen to DOM events. Input handling lives in the consumer so the
 * core stays framework-agnostic.
 */
export class DrawingLayer {
  private readonly _drawings: Drawing[] = [];
  private _active: Drawing | null = null;
  private _selectedId: string | null = null;
  private readonly _undoStack: DrawingSnapshot[][] = [];
  private readonly _redoStack: DrawingSnapshot[][] = [];

  /** All completed drawings plus the in-progress one (if any). */
  get drawings(): readonly Drawing[] {
    return this._drawings;
  }

  get active(): Drawing | null {
    return this._active;
  }

  /** Id of the currently-selected drawing, or null. */
  get selectedId(): string | null {
    return this._selectedId;
  }

  /** The currently-selected drawing instance, or null. */
  get selected(): Drawing | null {
    if (this._selectedId === null) return null;
    return this._drawings.find((d) => d.id === this._selectedId) ?? null;
  }

  /** Register a new subclass so `fromSnapshot` can hydrate it. */
  static registerKind(kind: string, factory: DrawingFactory): void {
    FACTORIES.set(kind, factory);
  }

  /**
   * Begin a new drawing. The drawing is immediately in the active slot
   * but not yet in `drawings`. The next `addPoint` call pushes the
   * first anchor; when the drawing becomes complete it is moved to
   * `drawings` and `active` is cleared.
   */
  startDrawing(drawing: Drawing): void {
    // Discard any previously-abandoned in-progress drawing.
    this._active = drawing;
  }

  /** Feed an anchor into the active drawing. Finalizes if complete. */
  addPoint(point: AnchorPoint): Drawing | null {
    if (!this._active) return null;
    this._active.addPoint(point);
    if (this._active.isComplete) {
      const finished = this._active;
      this._pushUndo();
      this._drawings.push(finished);
      this._active = null;
      return finished;
    }
    return null;
  }

  /**
   * Update the last anchor of the active drawing — used during
   * "rubber band" preview between clicks while a multi-point drawing
   * is still in progress.
   */
  updateActiveLastPoint(point: AnchorPoint): void {
    if (!this._active) return;
    this._active.updateLastPoint(point);
  }

  /** Abort the in-progress drawing without finalizing it. */
  cancelActive(): void {
    this._active = null;
  }

  /** Add a fully-constructed drawing directly (undoable). */
  add(drawing: Drawing): void {
    this._pushUndo();
    this._drawings.push(drawing);
  }

  /** Remove a drawing by id. Returns true if found. */
  remove(id: string): boolean {
    const idx = this._drawings.findIndex((d) => d.id === id);
    if (idx === -1) return false;
    this._pushUndo();
    this._drawings.splice(idx, 1);
    if (this._selectedId === id) this._selectedId = null;
    return true;
  }

  /** Remove every completed drawing. Does not touch the active slot. */
  clear(): void {
    if (this._drawings.length === 0) return;
    this._pushUndo();
    this._drawings.length = 0;
    this._selectedId = null;
  }

  /**
   * Return the topmost drawing whose rendered geometry is within
   * `tolerance` pixels of the screen point (x, y), or null. Iterates in
   * reverse paint order so the visually-frontmost drawing wins.
   */
  hitTest(
    x: number,
    y: number,
    layout: ChartLayout,
    viewport: Viewport,
    tolerance: number = DRAWING_HIT_TOLERANCE_PX,
  ): Drawing | null {
    for (let i = this._drawings.length - 1; i >= 0; i--) {
      const d = this._drawings[i]!;
      if (d.hitTest(x, y, layout, viewport, tolerance)) return d;
    }
    return null;
  }

  /**
   * Hit-test at (x, y) and select the topmost drawing found (or clear the
   * selection when nothing is hit). Returns the newly-selected drawing.
   */
  selectAt(
    x: number,
    y: number,
    layout: ChartLayout,
    viewport: Viewport,
    tolerance: number = DRAWING_HIT_TOLERANCE_PX,
  ): Drawing | null {
    const hit = this.hitTest(x, y, layout, viewport, tolerance);
    this._selectedId = hit ? hit.id : null;
    return hit;
  }

  /** Select a drawing by id, or clear the selection with null. */
  select(id: string | null): void {
    if (id === null || this._drawings.some((d) => d.id === id)) {
      this._selectedId = id;
    }
  }

  /** Remove the selected drawing, if any. Returns true if one was removed. */
  removeSelected(): boolean {
    if (this._selectedId === null) return false;
    return this.remove(this._selectedId);
  }

  /** True if there is a state to undo / redo. */
  get canUndo(): boolean {
    return this._undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  /** Revert the last mutation (add / remove / clear). Returns true if applied. */
  undo(): boolean {
    const prev = this._undoStack.pop();
    if (prev === undefined) return false;
    this._redoStack.push(this._snapshot());
    this._hydrateInto(prev);
    this._active = null;
    this._selectedId = null;
    return true;
  }

  /** Re-apply the last undone mutation. Returns true if applied. */
  redo(): boolean {
    const next = this._redoStack.pop();
    if (next === undefined) return false;
    this._undoStack.push(this._snapshot());
    this._hydrateInto(next);
    this._active = null;
    this._selectedId = null;
    return true;
  }

  private _snapshot(): DrawingSnapshot[] {
    return this._drawings.map((d) => d.toSnapshot());
  }

  /** Capture current state for undo and invalidate the redo stack. */
  private _pushUndo(): void {
    this._undoStack.push(this._snapshot());
    this._redoStack.length = 0;
  }

  /** Replace all drawings from snapshots without recording undo history. */
  private _hydrateInto(snapshots: DrawingSnapshot[]): void {
    this._drawings.length = 0;
    for (const snap of snapshots) {
      const factory = FACTORIES.get(snap.kind);
      if (factory) this._drawings.push(factory(snap));
    }
  }

  /**
   * Shift every anchor's buffer index by `delta`. Called after the buffer
   * evicts old candles (eviction lowers every remaining candle's logical
   * index) so drawings stay pinned to the same candles. Affects completed
   * drawings and the in-progress one; undo history is not rewritten.
   */
  shiftIndices(delta: number): void {
    if (delta === 0) return;
    for (const d of this._drawings) {
      for (const p of d.points) p.index += delta;
    }
    if (this._active) {
      for (const p of this._active.points) p.index += delta;
    }
  }

  /** Render all completed drawings plus the in-progress one. */
  render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    theme: ThemeColors,
  ): void {
    for (const d of this._drawings) d.render(ctx, layout, viewport, theme);
    if (this._active && this._active.points.length > 0) {
      this._active.render(ctx, layout, viewport, theme);
    }
    const sel = this.selected;
    if (sel) this._renderHandles(ctx, sel, layout, viewport, theme);
  }

  /** Draw square handles at the anchor points of the selected drawing. */
  private _renderHandles(
    ctx: CanvasRenderingContext2D,
    drawing: Drawing,
    layout: ChartLayout,
    viewport: Viewport,
    theme: ThemeColors,
  ): void {
    const half = DRAWING_HANDLE_PX / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      layout.chartLeft,
      layout.chartTop,
      layout.chartRight - layout.chartLeft,
      layout.chartBottom - layout.chartTop,
    );
    ctx.clip();
    ctx.fillStyle = drawing.color ?? theme.crosshair;
    ctx.strokeStyle = theme.background;
    ctx.lineWidth = 1;
    for (const p of drawing.points) {
      const cx = viewport.indexToX(p.index);
      const cy = viewport.priceToY(p.price);
      ctx.fillRect(cx - half, cy - half, DRAWING_HANDLE_PX, DRAWING_HANDLE_PX);
      ctx.strokeRect(cx - half + 0.5, cy - half + 0.5, DRAWING_HANDLE_PX, DRAWING_HANDLE_PX);
    }
    ctx.restore();
  }

  /** Serialize all completed drawings to a JSON-safe array. */
  toSnapshot(): DrawingSnapshot[] {
    return this._drawings.map((d) => d.toSnapshot());
  }

  /**
   * Restore drawings from a snapshot array. Unknown kinds are silently
   * skipped — consumers should register custom kinds before calling
   * `fromSnapshot` if they rely on them.
   */
  static fromSnapshot(snapshots: DrawingSnapshot[]): DrawingLayer {
    const layer = new DrawingLayer();
    // Hydrate directly (no undo history) — a freshly-loaded layer starts
    // with a clean undo stack.
    layer._hydrateInto(snapshots);
    return layer;
  }
}
