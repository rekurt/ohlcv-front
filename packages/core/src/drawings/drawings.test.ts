import { describe, it, expect, beforeEach } from 'vitest';
import { Drawing, type AnchorPoint } from './Drawing';
import { TrendLine } from './TrendLine';
import { HorizontalLine } from './HorizontalLine';
import { DrawingLayer } from './DrawingLayer';
import { Viewport } from '../interaction/Viewport';
import { computeLayout } from '../utils';
import { DARK_THEME } from '../constants';
import type { ChartLayout } from '../types';

const LAYOUT: ChartLayout = computeLayout(1000, 500);

function buildViewport(): Viewport {
  const vp = new Viewport();
  vp.setLayout(LAYOUT);
  vp.priceMin = 100;
  vp.priceMax = 200;
  return vp;
}

function makeCtx(): CanvasRenderingContext2D {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop: string) {
      if (prop === 'measureText') return (text: string) => ({ width: text.length * 6 });
      if (prop in target) return target[prop];
      return () => undefined;
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      return true;
    },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

describe('Drawing base', () => {
  class FakeTwoPoint extends Drawing {
    get kind(): string {
      return 'fake2';
    }
    get requiredPoints(): number {
      return 2;
    }
    render(): void {}
  }

  it('generates a random id when one is not provided', () => {
    const d = new FakeTwoPoint();
    expect(d.id).toMatch(/^d_/);
  });

  it('uses the provided id when one is given', () => {
    const d = new FakeTwoPoint('custom-id');
    expect(d.id).toBe('custom-id');
  });

  it('addPoint fills anchors up to requiredPoints', () => {
    const d = new FakeTwoPoint();
    expect(d.isComplete).toBe(false);
    d.addPoint({ index: 10, price: 100 });
    expect(d.isComplete).toBe(false);
    d.addPoint({ index: 20, price: 120 });
    expect(d.isComplete).toBe(true);
  });

  it('addPoint is a no-op after the drawing is complete', () => {
    const d = new FakeTwoPoint();
    d.addPoint({ index: 1, price: 100 });
    d.addPoint({ index: 2, price: 200 });
    d.addPoint({ index: 3, price: 300 });
    expect(d.points).toHaveLength(2);
  });

  it('updateLastPoint replaces the last anchor in place', () => {
    const d = new FakeTwoPoint();
    d.addPoint({ index: 1, price: 100 });
    d.updateLastPoint({ index: 5, price: 500 });
    expect(d.points[0]).toEqual({ index: 5, price: 500 });
  });

  it('toSnapshot round-trips through fromSnapshot', () => {
    const line = new TrendLine('abc');
    line.addPoint({ index: 1, price: 100 });
    line.addPoint({ index: 2, price: 200 });
    line.color = '#ff00ff';
    const snap = line.toSnapshot();
    expect(snap.id).toBe('abc');
    expect(snap.kind).toBe('trendline');
    expect(snap.points).toHaveLength(2);
    expect(snap.color).toBe('#ff00ff');
  });
});

describe('TrendLine', () => {
  it('kind is "trendline"', () => {
    expect(new TrendLine().kind).toBe('trendline');
  });

  it('requires 2 points', () => {
    expect(new TrendLine().requiredPoints).toBe(2);
  });

  it('render is a no-op when incomplete', () => {
    const line = new TrendLine();
    line.addPoint({ index: 10, price: 150 });
    const ctx = makeCtx();
    expect(() => line.render(ctx, LAYOUT, buildViewport(), DARK_THEME)).not.toThrow();
  });

  it('render draws two-point segment without throwing', () => {
    const line = new TrendLine();
    line.addPoint({ index: 10, price: 150 });
    line.addPoint({ index: 30, price: 170 });
    const ctx = makeCtx();
    expect(() => line.render(ctx, LAYOUT, buildViewport(), DARK_THEME)).not.toThrow();
  });
});

describe('HorizontalLine', () => {
  it('requires 1 point', () => {
    expect(new HorizontalLine().requiredPoints).toBe(1);
  });

  it('render emits a line + price label without throwing', () => {
    const line = new HorizontalLine();
    line.addPoint({ index: 0, price: 150 });
    const ctx = makeCtx();
    expect(() => line.render(ctx, LAYOUT, buildViewport(), DARK_THEME)).not.toThrow();
  });

  it('render is a no-op when price is outside the visible range', () => {
    const line = new HorizontalLine();
    line.addPoint({ index: 0, price: 1_000_000 });
    const ctx = makeCtx();
    expect(() => line.render(ctx, LAYOUT, buildViewport(), DARK_THEME)).not.toThrow();
  });
});

describe('DrawingLayer', () => {
  let layer: DrawingLayer;

  beforeEach(() => {
    layer = new DrawingLayer();
  });

  it('starts empty', () => {
    expect(layer.drawings).toHaveLength(0);
    expect(layer.active).toBeNull();
  });

  it('startDrawing puts the drawing into the active slot', () => {
    const line = new TrendLine();
    layer.startDrawing(line);
    expect(layer.active).toBe(line);
    expect(layer.drawings).toHaveLength(0);
  });

  it('addPoint accumulates anchors and finalizes on completion', () => {
    layer.startDrawing(new TrendLine());
    const firstResult = layer.addPoint({ index: 1, price: 100 });
    expect(firstResult).toBeNull(); // not yet complete
    const secondResult = layer.addPoint({ index: 2, price: 200 });
    expect(secondResult).not.toBeNull(); // completed
    expect(layer.drawings).toHaveLength(1);
    expect(layer.active).toBeNull();
  });

  it('addPoint is a no-op when no drawing is active', () => {
    const result = layer.addPoint({ index: 1, price: 100 });
    expect(result).toBeNull();
  });

  it('single-point drawings finalize on the first addPoint', () => {
    layer.startDrawing(new HorizontalLine());
    const result = layer.addPoint({ index: 0, price: 150 });
    expect(result).not.toBeNull();
    expect(layer.drawings).toHaveLength(1);
    expect(layer.active).toBeNull();
  });

  it('cancelActive drops the in-progress drawing without finalizing', () => {
    layer.startDrawing(new TrendLine());
    layer.addPoint({ index: 1, price: 100 });
    layer.cancelActive();
    expect(layer.active).toBeNull();
    expect(layer.drawings).toHaveLength(0);
  });

  it('updateActiveLastPoint replaces the preview anchor', () => {
    layer.startDrawing(new TrendLine());
    layer.addPoint({ index: 1, price: 100 });
    // At this point the drawing has 1 point but we haven't added the
    // second — use updateLastPoint to move point 0 during drag
    layer.updateActiveLastPoint({ index: 3, price: 150 });
    expect(layer.active!.points[0]).toEqual({ index: 3, price: 150 });
  });

  it('remove deletes a drawing by id', () => {
    const line = new TrendLine('target');
    line.addPoint({ index: 1, price: 100 });
    line.addPoint({ index: 2, price: 200 });
    layer.add(line);
    expect(layer.remove('target')).toBe(true);
    expect(layer.drawings).toHaveLength(0);
  });

  it('remove returns false for unknown ids', () => {
    expect(layer.remove('nope')).toBe(false);
  });

  it('clear wipes all completed drawings', () => {
    const a = new TrendLine('a');
    const b = new HorizontalLine('b');
    a.addPoint({ index: 1, price: 100 });
    a.addPoint({ index: 2, price: 200 });
    b.addPoint({ index: 0, price: 150 });
    layer.add(a);
    layer.add(b);
    layer.clear();
    expect(layer.drawings).toHaveLength(0);
  });

  it('render draws all completed drawings + active one', () => {
    const ctx = makeCtx();
    const vp = buildViewport();
    layer.add(
      (() => {
        const l = new TrendLine();
        l.addPoint({ index: 1, price: 100 });
        l.addPoint({ index: 2, price: 200 });
        return l;
      })(),
    );
    layer.startDrawing(new HorizontalLine());
    layer.updateActiveLastPoint({ index: 0, price: 150 });
    // Seed the active drawing with one point (without finalizing)
    const active = layer.active!;
    (active.points as AnchorPoint[]).push({ index: 0, price: 150 });
    expect(() => layer.render(ctx, LAYOUT, vp, DARK_THEME)).not.toThrow();
  });

  it('toSnapshot + fromSnapshot round-trip preserves drawings', () => {
    const line = new TrendLine('preserved');
    line.addPoint({ index: 5, price: 130 });
    line.addPoint({ index: 15, price: 170 });
    line.color = '#123456';
    layer.add(line);

    const snap = layer.toSnapshot();
    expect(snap).toHaveLength(1);

    const restored = DrawingLayer.fromSnapshot(snap);
    expect(restored.drawings).toHaveLength(1);
    const restoredLine = restored.drawings[0]!;
    expect(restoredLine.id).toBe('preserved');
    expect(restoredLine.kind).toBe('trendline');
    expect(restoredLine.points).toHaveLength(2);
    expect(restoredLine.color).toBe('#123456');
  });

  it('fromSnapshot silently skips unknown kinds', () => {
    const restored = DrawingLayer.fromSnapshot([
      { id: 'a', kind: 'never-seen', points: [] },
    ]);
    expect(restored.drawings).toHaveLength(0);
  });
});

// Н2: during replay the buffer physically holds bars past the cap, so a
// drawing whose every anchor sits in the not-yet-revealed future zone must be
// hidden from both rendering and hit-testing — symmetric with MarkerRenderer
// (Г3c). The engine threads maxVisibleIndex() into render()/hitTest().
describe('DrawingLayer replay clamp (Н2)', () => {
  /** Minimal drawing that counts its renders and reports a hit unconditionally. */
  class RecordingDrawing extends Drawing {
    rendered = 0;
    constructor(pts: AnchorPoint[], id?: string) {
      super(id);
      pts.forEach((p) => this.points.push(p));
    }
    get kind(): string {
      return 'rec';
    }
    get requiredPoints(): number {
      return 2;
    }
    render(): void {
      this.rendered++;
    }
    // Geometry-agnostic: always "hit" if the layer reaches it, so the only
    // thing that can suppress a hit is the maxIndex gate under test.
    override hitTest(): boolean {
      return true;
    }
  }

  it('hides a drawing whose every anchor is past the cap (render + hitTest)', () => {
    const layer = new DrawingLayer();
    // `past` added first, `future` second — hitTest walks newest→oldest, so
    // without the gate `future` would be returned first. The gate must skip it.
    const past = new RecordingDrawing([{ index: 5, price: 150 }, { index: 8, price: 160 }], 'past');
    const future = new RecordingDrawing(
      [{ index: 50, price: 150 }, { index: 60, price: 160 }],
      'future',
    );
    layer.add(past);
    layer.add(future);
    const vp = buildViewport();

    // maxIndex = 19: future (anchors 50,60) hidden; past (5,8) shown.
    layer.render(makeCtx(), LAYOUT, vp, DARK_THEME, 19);
    expect(future.rendered).toBe(0);
    expect(past.rendered).toBe(1);

    // A click resolves to the revealed `past`, never the future-zone drawing.
    expect(layer.hitTest(500, 250, LAYOUT, vp, undefined, 19)?.id).toBe('past');

    // Anti-tautology: lift the cap (default Infinity) and the future drawing
    // both renders and is hit first — proving the suppression is the gate, not
    // fixture order.
    future.rendered = 0;
    past.rendered = 0;
    layer.render(makeCtx(), LAYOUT, vp, DARK_THEME);
    expect(future.rendered).toBe(1);
    expect(past.rendered).toBe(1);
    expect(layer.hitTest(500, 250, LAYOUT, vp)?.id).toBe('future');
  });

  it('shows a drawing with at least one revealed anchor even if another is in the future', () => {
    const layer = new DrawingLayer();
    // Anchor 5 is revealed (<= cap 19), anchor 80 is not — the drawing straddles
    // the cap and must still render (you can see the revealed end of the line).
    const straddle = new RecordingDrawing(
      [{ index: 5, price: 150 }, { index: 80, price: 160 }],
      'straddle',
    );
    layer.add(straddle);
    layer.render(makeCtx(), LAYOUT, buildViewport(), DARK_THEME, 19);
    expect(straddle.rendered).toBe(1);
  });
});
