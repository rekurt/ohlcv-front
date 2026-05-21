import { describe, it, expect, beforeEach } from 'vitest';
import { TrendLine } from './TrendLine';
import { HorizontalLine } from './HorizontalLine';
import { VerticalLine } from './VerticalLine';
import { Rectangle } from './Rectangle';
import { DrawingLayer } from './DrawingLayer';
import { Viewport } from '../interaction/Viewport';
import { computeLayout } from '../utils';
import type { ChartLayout } from '../types';

const LAYOUT: ChartLayout = computeLayout(1000, 500);

function buildViewport(): Viewport {
  const vp = new Viewport();
  vp.setLayout(LAYOUT);
  vp.startIndex = 0;
  vp.priceMin = 100;
  vp.priceMax = 200;
  return vp;
}

const vp = buildViewport();

/** Project a buffer anchor to screen coordinates via the viewport. */
function screen(index: number, price: number): { x: number; y: number } {
  return { x: vp.indexToX(index), y: vp.priceToY(price) };
}

describe('Drawing.hitTest', () => {
  it('TrendLine: hits near the segment, misses far away', () => {
    const t = new TrendLine();
    t.addPoint({ index: 5, price: 150 });
    t.addPoint({ index: 15, price: 160 });
    const a = screen(5, 150);
    const b = screen(15, 160);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    expect(t.hitTest(mid.x, mid.y, LAYOUT, vp)).toBe(true);
    expect(t.hitTest(mid.x, mid.y + 60, LAYOUT, vp)).toBe(false);
  });

  it('HorizontalLine: hits at its price across the full width, misses other prices', () => {
    const h = new HorizontalLine();
    h.addPoint({ index: 0, price: 150 });
    const y = vp.priceToY(150);
    expect(h.hitTest(LAYOUT.chartLeft + 5, y, LAYOUT, vp)).toBe(true);
    expect(h.hitTest(LAYOUT.chartRight - 5, y, LAYOUT, vp)).toBe(true);
    expect(h.hitTest(LAYOUT.chartLeft + 5, vp.priceToY(120), LAYOUT, vp)).toBe(false);
  });

  it('VerticalLine: hits along its index column, misses other columns', () => {
    const v = new VerticalLine();
    v.addPoint({ index: 10, price: 0 });
    const x = vp.indexToX(10);
    expect(v.hitTest(x, LAYOUT.chartTop + 20, LAYOUT, vp)).toBe(true);
    expect(v.hitTest(x, LAYOUT.chartBottom - 20, LAYOUT, vp)).toBe(true);
    expect(v.hitTest(x + 40, LAYOUT.chartTop + 20, LAYOUT, vp)).toBe(false);
  });

  it('Rectangle: hits inside the box, misses outside', () => {
    const r = new Rectangle();
    r.addPoint({ index: 5, price: 180 });
    r.addPoint({ index: 20, price: 140 });
    const inside = { x: vp.indexToX(12), y: vp.priceToY(160) };
    expect(r.hitTest(inside.x, inside.y, LAYOUT, vp)).toBe(true);
    expect(r.hitTest(vp.indexToX(40), inside.y, LAYOUT, vp)).toBe(false);
  });
});

describe('DrawingLayer selection', () => {
  let layer: DrawingLayer;
  let line: TrendLine;
  let hline: HorizontalLine;

  beforeEach(() => {
    layer = new DrawingLayer();
    line = new TrendLine('l1');
    line.addPoint({ index: 5, price: 150 });
    line.addPoint({ index: 15, price: 160 });
    hline = new HorizontalLine('h1');
    hline.addPoint({ index: 0, price: 150 });
    layer.add(line);
    layer.add(hline);
  });

  it('hitTest returns the topmost drawing under the point', () => {
    // Both pass through price ~150 near index 5; hline is added last → topmost.
    const y = vp.priceToY(150);
    const hit = layer.hitTest(vp.indexToX(5), y, LAYOUT, vp);
    expect(hit?.id).toBe('h1');
  });

  it('selectAt selects a hit and clears when nothing is hit', () => {
    const y = vp.priceToY(150);
    expect(layer.selectAt(vp.indexToX(5), y, LAYOUT, vp)?.id).toBe('h1');
    expect(layer.selectedId).toBe('h1');
    // Click in empty space far from any drawing.
    expect(layer.selectAt(vp.indexToX(40), vp.priceToY(199), LAYOUT, vp)).toBeNull();
    expect(layer.selectedId).toBeNull();
  });

  it('removeSelected deletes the selected drawing and clears selection', () => {
    layer.select('h1');
    expect(layer.removeSelected()).toBe(true);
    expect(layer.drawings.map((d) => d.id)).toEqual(['l1']);
    expect(layer.selectedId).toBeNull();
  });
});

describe('DrawingLayer undo/redo', () => {
  it('undoes an add and redoes it', () => {
    const layer = new DrawingLayer();
    const t = new TrendLine('t1');
    t.addPoint({ index: 1, price: 110 });
    t.addPoint({ index: 2, price: 120 });
    layer.add(t);
    expect(layer.drawings).toHaveLength(1);

    expect(layer.undo()).toBe(true);
    expect(layer.drawings).toHaveLength(0);

    expect(layer.redo()).toBe(true);
    expect(layer.drawings.map((d) => d.id)).toEqual(['t1']);
  });

  it('undoes a clear', () => {
    const layer = new DrawingLayer();
    const t = new TrendLine('t1');
    t.addPoint({ index: 1, price: 110 });
    t.addPoint({ index: 2, price: 120 });
    layer.add(t);
    layer.clear();
    expect(layer.drawings).toHaveLength(0);
    expect(layer.undo()).toBe(true);
    expect(layer.drawings.map((d) => d.id)).toEqual(['t1']);
  });

  it('a new mutation invalidates the redo stack', () => {
    const layer = new DrawingLayer();
    const a = new TrendLine('a');
    a.addPoint({ index: 1, price: 110 });
    a.addPoint({ index: 2, price: 120 });
    layer.add(a);
    layer.undo();
    expect(layer.canRedo).toBe(true);
    const b = new HorizontalLine('b');
    b.addPoint({ index: 0, price: 150 });
    layer.add(b);
    expect(layer.canRedo).toBe(false);
  });

  it('reports canUndo / canRedo correctly on an empty layer', () => {
    const layer = new DrawingLayer();
    expect(layer.canUndo).toBe(false);
    expect(layer.canRedo).toBe(false);
    expect(layer.undo()).toBe(false);
    expect(layer.redo()).toBe(false);
  });
});

describe('DrawingLayer.shiftIndices', () => {
  it('shifts every anchor index by delta (completed + active)', () => {
    const layer = new DrawingLayer();
    const t = new TrendLine('t1');
    t.addPoint({ index: 90, price: 100 });
    t.addPoint({ index: 95, price: 101 });
    layer.add(t);
    const active = new TrendLine('a1');
    active.addPoint({ index: 80, price: 100 });
    layer.startDrawing(active);

    layer.shiftIndices(-50);

    expect(layer.drawings[0]!.points.map((p) => p.index)).toEqual([40, 45]);
    expect(layer.active!.points[0]!.index).toBe(30);
  });

  it('is a no-op for delta 0', () => {
    const layer = new DrawingLayer();
    const t = new TrendLine('t1');
    t.addPoint({ index: 5, price: 100 });
    t.addPoint({ index: 6, price: 101 });
    layer.add(t);
    layer.shiftIndices(0);
    expect(layer.drawings[0]!.points.map((p) => p.index)).toEqual([5, 6]);
  });

  it('reindexes undo snapshots so undo after a shift restores correct indices', () => {
    const layer = new DrawingLayer();
    const a = new TrendLine('a');
    a.addPoint({ index: 90, price: 100 });
    a.addPoint({ index: 95, price: 101 });
    layer.add(a); // undo snapshot: [] (pre-add)
    const b = new TrendLine('b');
    b.addPoint({ index: 80, price: 100 });
    b.addPoint({ index: 85, price: 101 });
    layer.add(b); // undo snapshot: [a@90,95]

    layer.shiftIndices(-50); // live a@40,45 b@30,35; snapshot a must shift too

    expect(layer.undo()).toBe(true); // restore the [a] snapshot
    expect(layer.drawings.map((d) => d.id)).toEqual(['a']);
    // Without snapshot reindexing this would restore the stale 90/95.
    expect(layer.drawings[0]!.points.map((p) => p.index)).toEqual([40, 45]);
  });
});
