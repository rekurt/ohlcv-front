import type { Drawing, DrawingSnapshot, AnchorPoint } from './Drawing';
import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';
import { TrendLine } from './TrendLine';
import { HorizontalLine } from './HorizontalLine';
import { Rectangle } from './Rectangle';
import { Ray } from './Ray';
import { VerticalLine } from './VerticalLine';
import { FibRetracement } from './FibRetracement';

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

  /** All completed drawings plus the in-progress one (if any). */
  get drawings(): readonly Drawing[] {
    return this._drawings;
  }

  get active(): Drawing | null {
    return this._active;
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

  /** Add a fully-constructed drawing directly, e.g. from hydration. */
  add(drawing: Drawing): void {
    this._drawings.push(drawing);
  }

  /** Remove a drawing by id. Returns true if found. */
  remove(id: string): boolean {
    const idx = this._drawings.findIndex((d) => d.id === id);
    if (idx === -1) return false;
    this._drawings.splice(idx, 1);
    return true;
  }

  /** Remove every completed drawing. Does not touch the active slot. */
  clear(): void {
    this._drawings.length = 0;
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
    for (const snap of snapshots) {
      const factory = FACTORIES.get(snap.kind);
      if (!factory) continue;
      layer.add(factory(snap));
    }
    return layer;
  }
}
