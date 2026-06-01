import { describe, it, expect } from 'vitest';
import { BaselineRenderer } from './BaselineRenderer';
import { DARK_THEME } from '../constants';
import type { CandleView, ChartLayout } from '../types';
import type { Viewport } from '../interaction/Viewport';

interface Op {
  op: string;
  fillStyle?: unknown;
  strokeStyle?: unknown;
}

function makeCtx(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = [];
  let fillStyle: unknown = '';
  let strokeStyle: unknown = '';
  const ctx = {
    save: () => ops.push({ op: 'save' }),
    restore: () => ops.push({ op: 'restore' }),
    beginPath: () => ops.push({ op: 'beginPath' }),
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => ops.push({ op: 'closePath' }),
    rect: () => ops.push({ op: 'rect' }),
    clip: () => ops.push({ op: 'clip' }),
    fill: () => ops.push({ op: 'fill', fillStyle }),
    stroke: () => ops.push({ op: 'stroke', strokeStyle }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    set fillStyle(v: unknown) {
      fillStyle = v;
    },
    get fillStyle() {
      return fillStyle;
    },
    set strokeStyle(v: unknown) {
      strokeStyle = v;
    },
    get strokeStyle() {
      return strokeStyle;
    },
    lineWidth: 0,
    lineJoin: '',
    lineCap: '',
  } as unknown as CanvasRenderingContext2D;
  return { ctx, ops };
}

// Simple linear price→Y: base 100 maps to y=300, +1 price → −2 px (up).
const viewport = {
  indexToX: (i: number) => 60 + i * 10,
  priceToY: (p: number) => 300 - (p - 100) * 2,
} as unknown as Viewport;

const layout = {
  chartLeft: 50,
  chartTop: 0,
  chartRight: 900,
  chartBottom: 400,
  width: 950,
  height: 450,
} as unknown as ChartLayout;

function viewOf(closes: number[]): CandleView {
  const close = Float64Array.from(closes);
  const z = new Float64Array(closes.length);
  return {
    open: z,
    high: close,
    low: close,
    close,
    volume: z,
    time: z,
    length: closes.length,
    offset: 0,
  };
}

describe('BaselineRenderer', () => {
  const r = new BaselineRenderer();

  it('draws nothing for an empty view', () => {
    const { ctx, ops } = makeCtx();
    r.render(ctx, layout, viewport, viewOf([]), DARK_THEME);
    expect(ops.filter((o) => o.op === 'fill')).toHaveLength(0);
  });

  it('paints both regions (above + below baseline) with one clip + fill + stroke each', () => {
    const { ctx, ops } = makeCtx();
    // Default base = first visible close (100). Values cross above and below.
    r.render(ctx, layout, viewport, viewOf([100, 110, 90, 105]), DARK_THEME);
    expect(ops.filter((o) => o.op === 'clip')).toHaveLength(2);
    expect(ops.filter((o) => o.op === 'fill')).toHaveLength(2);
    expect(ops.filter((o) => o.op === 'stroke')).toHaveLength(2);
  });

  it('uses top color above and bottom color below the baseline', () => {
    const { ctx, ops } = makeCtx();
    r.render(ctx, layout, viewport, viewOf([100, 110, 90]), DARK_THEME, {
      topLine: '#aaaaaa',
      bottomLine: '#bbbbbb',
    });
    const strokes = ops.filter((o) => o.op === 'stroke').map((o) => o.strokeStyle);
    expect(strokes).toEqual(['#aaaaaa', '#bbbbbb']);
  });

  it('colors the whole series with one side when baseValue is off-pane', () => {
    const { ctx, ops } = makeCtx();
    // baseValue far above the visible range → split clamps to chartTop, so the
    // "above" region has zero height and only the bottom side paints.
    r.render(ctx, layout, viewport, viewOf([100, 105, 110]), DARK_THEME, { baseValue: 1000 });
    expect(ops.filter((o) => o.op === 'fill')).toHaveLength(1);
  });

  it('does not throw on a conflated view (repIndex present)', () => {
    const v = viewOf([100, 102, 101]);
    (v as { repIndex?: Int32Array }).repIndex = Int32Array.from([0, 1, 2]);
    const { ctx } = makeCtx();
    expect(() => r.render(ctx, layout, viewport, v, DARK_THEME)).not.toThrow();
  });
});
