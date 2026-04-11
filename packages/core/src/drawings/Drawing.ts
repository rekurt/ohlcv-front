import type { ChartLayout, ThemeColors } from '../types';
import type { Viewport } from '../interaction/Viewport';

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

  toSnapshot(): DrawingSnapshot {
    return {
      id: this.id,
      kind: this.kind,
      points: this.points.map((p) => ({ ...p })),
      color: this.color ?? undefined,
    };
  }
}

function randomId(): string {
  // Not crypto-grade — just unique enough for a local collection.
  return `d_${Math.random().toString(36).slice(2, 10)}`;
}
