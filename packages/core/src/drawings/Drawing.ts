import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';
import { DRAWING_HIT_TOLERANCE_PX } from '../constants';
import { distanceToSegment } from './geometry';

/**
 * A single anchor of a drawing, expressed in BUFFER SPACE:
 * - `index` is a (possibly fractional) buffer index — so the drawing
 *   sticks to the underlying candle regardless of pan/zoom
 * - `price` is a raw price value that maps to Y via the viewport's
 *   current price range
 *
 * Screen-space coordinates are intentionally avoided: they would drift
 * whenever the user zooms or the price axis re-scales.
 */
export interface AnchorPoint {
  index: number;
  price: number;
}

/**
 * Serialized form of a drawing — JSON-safe representation for
 * persistence (localStorage, remote API, etc.). `kind` discriminates
 * the subclass; `id` is a stable random string assigned on creation.
 */
export interface DrawingSnapshot {
  id: string;
  kind: string;
  points: AnchorPoint[];
  color?: string;
  /**
   * Optional opaque numeric payload for drawings that derive geometry
   * from sampled data rather than purely from anchors — currently the
   * regression channel, which stores the `close` series of its index
   * span so the least-squares fit round-trips exactly without needing
   * the candle buffer at render time. Subclasses that don't use it
   * leave it `undefined`, so existing snapshots stay byte-compatible.
   */
  data?: number[];
}

/**
 * Base class for anchored drawings (trend line, horizontal line, ray,
 * fib retracement, rectangle, etc.). Subclasses declare how many points
 * they need and how to render into the canvas.
 *
 * Drawings live in a DrawingLayer and are rendered in order via
 * `DrawingLayer.render()`. Creation state is tracked by the parent
 * layer: during input, a drawing is considered "in progress" until its
 * point count matches `requiredPoints`.
 */
export abstract class Drawing {
  readonly id: string;
  readonly points: AnchorPoint[] = [];
  color: string | null = null;

  constructor(id?: string) {
    this.id = id ?? randomId();
  }

  /** Unique discriminator used in snapshots. Subclasses override. */
  abstract get kind(): string;

  /** How many clicks are needed before the drawing is "complete". */
  abstract get requiredPoints(): number;

  /** Render the drawing into the canvas. */
  abstract render(
    ctx: CanvasRenderingContext2D,
    layout: ChartLayout,
    viewport: Viewport,
    theme: ThemeColors,
  ): void;

  /**
   * Hit-test a screen point (in canvas pixels) against this drawing for
   * selection. Returns true when the point is within `tolerance` pixels of
   * the rendered geometry.
   *
   * The default implementation treats the anchors as a polyline (correct
   * for segment shapes like TrendLine and Arrow). Shapes whose rendered
   * geometry differs from a simple anchor polyline — full-width/height
   * lines, rectangles, rays, channels, fib levels — override this.
   */
  hitTest(
    x: number,
    y: number,
    layout: ChartLayout,
    viewport: Viewport,
    tolerance: number = DRAWING_HIT_TOLERANCE_PX,
  ): boolean {
    if (x < layout.chartLeft || x > layout.chartRight) return false;
    if (y < layout.chartTop || y > layout.chartBottom) return false;
    const pts = this.points;
    if (pts.length === 0) return false;
    const sx = pts.map((p) => viewport.indexToX(p.index));
    const sy = pts.map((p) => viewport.priceToY(p.price));
    if (pts.length === 1) {
      return Math.hypot(x - sx[0]!, y - sy[0]!) <= tolerance;
    }
    let min = Infinity;
    for (let i = 1; i < pts.length; i++) {
      min = Math.min(min, distanceToSegment(x, y, sx[i - 1]!, sy[i - 1]!, sx[i]!, sy[i]!));
    }
    return min <= tolerance;
  }

  /** True once `requiredPoints` clicks have been collected. */
  get isComplete(): boolean {
    return this.points.length >= this.requiredPoints;
  }

  /** Add a point to the drawing if still incomplete. No-op otherwise. */
  addPoint(point: AnchorPoint): void {
    if (this.isComplete) return;
    this.points.push(point);
  }

  /** Replace the last anchor — useful for "live preview" drag feedback. */
  updateLastPoint(point: AnchorPoint): void {
    if (this.points.length === 0) return;
    this.points[this.points.length - 1] = point;
  }

  /**
   * Optional numeric payload persisted alongside the anchors. The base
   * class emits nothing; subclasses that derive geometry from sampled
   * data (regression channel) override this so the snapshot round-trips
   * exactly. Mirrors {@link restoreData}.
   */
  protected snapshotData(): number[] | undefined {
    return undefined;
  }

  /**
   * Restore the numeric payload produced by {@link snapshotData}. Called
   * by the snapshot factory after the anchors are populated. No-op in the
   * base class.
   */
  restoreData(_data: number[] | undefined): void {
    /* no-op by default */
  }

  toSnapshot(): DrawingSnapshot {
    const data = this.snapshotData();
    return {
      id: this.id,
      kind: this.kind,
      points: this.points.map((p) => ({ ...p })),
      color: this.color ?? undefined,
      ...(data !== undefined ? { data: data.slice() } : {}),
    };
  }
}

function randomId(): string {
  // Not crypto-grade — just unique enough for a local collection.
  return `d_${Math.random().toString(36).slice(2, 10)}`;
}
