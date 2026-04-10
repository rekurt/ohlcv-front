import { describe, it, expect, beforeEach } from 'vitest';
import { LineRenderer } from './LineRenderer';
import { AreaRenderer } from './AreaRenderer';
import { OHLCBarRenderer } from './OHLCBarRenderer';
import { Viewport } from '../interaction/Viewport';
import { CandleBuffer } from '../data/CandleBuffer';
import { computeLayout } from '../utils';
import { DARK_THEME } from '../constants';
import type { Candle, CandleView, ChartLayout } from '../types';

function makeCandle(i: number): Candle {
  const base = 100 + i * 0.1;
  return { o: base, h: base + 0.5, l: base - 0.5, c: base + 0.2, v: 1000, t: 1_700_000_000 + i * 60 };
}

function fillBuffer(n: number): CandleBuffer {
  const buf = new CandleBuffer();
  for (let i = 0; i < n; i++) buf.append(makeCandle(i));
  return buf;
}

/** Minimal CanvasRenderingContext2D stub — jsdom has no canvas. */
function makeCtx(): CanvasRenderingContext2D {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop: string) {
      if (prop === 'measureText') return (text: string) => ({ width: text.length * 6 });
      if (prop === 'createLinearGradient') {
        return () => ({ addColorStop: () => undefined });
      }
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

const LAYOUT: ChartLayout = computeLayout(1000, 500);

function buildView(buffer: CandleBuffer): { viewport: Viewport; view: CandleView } {
  const viewport = new Viewport();
  viewport.setLayout(LAYOUT);
  viewport.scrollToEnd(buffer.length);
  viewport.autoScale(buffer);
  const start = Math.max(0, Math.floor(viewport.startIndex));
  const end = Math.min(buffer.length, Math.ceil(viewport.startIndex + viewport.visibleCount));
  return { viewport, view: buffer.sliceView(start, end) };
}

describe('LineRenderer', () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('does not throw on empty view', () => {
    const { viewport, view } = buildView(new CandleBuffer());
    const r = new LineRenderer();
    expect(() => r.render(ctx, LAYOUT, viewport, view, DARK_THEME)).not.toThrow();
  });

  it('does not throw on single candle', () => {
    const { viewport, view } = buildView(fillBuffer(1));
    const r = new LineRenderer();
    expect(() => r.render(ctx, LAYOUT, viewport, view, DARK_THEME)).not.toThrow();
  });

  it('does not throw on 1000 candles', () => {
    const { viewport, view } = buildView(fillBuffer(1000));
    const r = new LineRenderer();
    expect(() => r.render(ctx, LAYOUT, viewport, view, DARK_THEME)).not.toThrow();
  });

  it('accepts an optional custom color', () => {
    const { viewport, view } = buildView(fillBuffer(10));
    const r = new LineRenderer();
    expect(() => r.render(ctx, LAYOUT, viewport, view, DARK_THEME, '#ff00ff')).not.toThrow();
  });
});

describe('AreaRenderer', () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('does not throw on empty view', () => {
    const { viewport, view } = buildView(new CandleBuffer());
    const r = new AreaRenderer();
    expect(() => r.render(ctx, LAYOUT, viewport, view, DARK_THEME)).not.toThrow();
  });

  it('does not throw on populated view', () => {
    const { viewport, view } = buildView(fillBuffer(100));
    const r = new AreaRenderer();
    expect(() => r.render(ctx, LAYOUT, viewport, view, DARK_THEME)).not.toThrow();
  });

  it('accepts custom fill and stroke colors', () => {
    const { viewport, view } = buildView(fillBuffer(10));
    const r = new AreaRenderer();
    expect(() =>
      r.render(ctx, LAYOUT, viewport, view, DARK_THEME, '#00aaff', '#ffffff'),
    ).not.toThrow();
  });

  it('handles hex and rgba color inputs without throwing', () => {
    const { viewport, view } = buildView(fillBuffer(10));
    const r = new AreaRenderer();
    expect(() => r.render(ctx, LAYOUT, viewport, view, DARK_THEME, '#00aaff')).not.toThrow();
    expect(() => r.render(ctx, LAYOUT, viewport, view, DARK_THEME, 'rgba(0,170,255,1)')).not.toThrow();
  });
});

describe('OHLCBarRenderer', () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('does not throw on empty view', () => {
    const { viewport, view } = buildView(new CandleBuffer());
    const r = new OHLCBarRenderer();
    expect(() => r.render(ctx, LAYOUT, viewport, view, DARK_THEME)).not.toThrow();
  });

  it('does not throw on populated view', () => {
    const { viewport, view } = buildView(fillBuffer(500));
    const r = new OHLCBarRenderer();
    expect(() => r.render(ctx, LAYOUT, viewport, view, DARK_THEME)).not.toThrow();
  });
});
