import { describe, it, expect, beforeEach } from 'vitest';
import { GridRenderer } from './GridRenderer';
import { CandleRenderer } from './CandleRenderer';
import { VolumeRenderer } from './VolumeRenderer';
import { PriceAxisRenderer } from './PriceAxis';
import { TimeAxisRenderer } from './TimeAxis';
import { TimeScaleBehavior } from '../horzscale/TimeScaleBehavior';
import { CrosshairRenderer, type CrosshairState } from './CrosshairRenderer';
import { PriceLineRenderer } from './PriceLineRenderer';
import { LegendRenderer } from './LegendRenderer';
import { GoToLiveRenderer } from './GoToLiveRenderer';
import { Viewport } from '../interaction/Viewport';
import { CandleBuffer } from '../data/CandleBuffer';
import { computeLayout } from '../utils';
import { DARK_THEME } from '../constants';
import type { Candle, CandleView, ChartLayout } from '../types';

/**
 * Smoke tests for every renderer. Each renderer is called with three fixture
 * sizes — empty, 1 candle, 1000 candles — and asserted not to throw. This
 * catches the most common regression: "off-by-one that crashes on empty
 * view" / "division by zero at small sizes".
 *
 * Visual regression would need snapshot or pixel-diff testing; this layer
 * only verifies the lifecycle contract.
 */

function makeCandle(i: number): Candle {
  const base = 100 + i * 0.1;
  return {
    o: base,
    h: base + 0.5,
    l: base - 0.5,
    c: base + 0.2,
    v: 1000 + i,
    t: 1_700_000_000 + i * 60,
  };
}

function fillBuffer(n: number): CandleBuffer {
  const buf = new CandleBuffer();
  for (let i = 0; i < n; i++) buf.append(makeCandle(i));
  return buf;
}

/**
 * Minimal 2D context stub — jsdom does not implement the canvas API so we
 * can't call `canvas.getContext('2d')`. Every method the renderers touch is
 * stubbed as a no-op; `measureText` returns a predictable width so label
 * positioning code can still compute something. Properties like `font` and
 * `fillStyle` are writable because the proxy accepts any assignment.
 */
function makeCtx(): CanvasRenderingContext2D {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop: string) {
      if (prop === 'measureText') {
        return (text: string) => ({ width: text.length * 6 });
      }
      if (prop === 'getImageData') {
        return () => ({ data: new Uint8ClampedArray(4) });
      }
      if (prop in target) return target[prop];
      // Any other method call is a no-op.
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

function buildViewportWith(buffer: CandleBuffer): { viewport: Viewport; view: CandleView } {
  const viewport = new Viewport();
  viewport.setLayout(LAYOUT);
  viewport.scrollToEnd(buffer.length);
  viewport.autoScale(buffer);
  const start = Math.max(0, Math.floor(viewport.startIndex));
  const end = Math.min(buffer.length, Math.ceil(viewport.startIndex + viewport.visibleCount));
  const view = buffer.sliceView(start, end);
  return { viewport, view };
}

interface Case {
  name: string;
  buffer: CandleBuffer;
}

const cases: Case[] = [
  { name: 'empty buffer', buffer: new CandleBuffer() },
  { name: 'single candle', buffer: fillBuffer(1) },
  { name: 'thousand candles', buffer: fillBuffer(1000) },
];

describe('renderers — smoke (empty / 1 / 1000)', () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = makeCtx();
  });

  for (const c of cases) {
    describe(c.name, () => {
      it('GridRenderer does not throw', () => {
        const { viewport } = buildViewportWith(c.buffer);
        const r = new GridRenderer();
        expect(() => r.render(ctx, LAYOUT, viewport, DARK_THEME)).not.toThrow();
      });

      it('CandleRenderer does not throw', () => {
        const { viewport, view } = buildViewportWith(c.buffer);
        const r = new CandleRenderer();
        expect(() => r.render(ctx, LAYOUT, viewport, view, DARK_THEME)).not.toThrow();
      });

      it('VolumeRenderer does not throw', () => {
        const { viewport, view } = buildViewportWith(c.buffer);
        const r = new VolumeRenderer();
        expect(() => r.render(ctx, LAYOUT, viewport, view, DARK_THEME)).not.toThrow();
      });

      it('PriceAxisRenderer.render does not throw', () => {
        const { viewport } = buildViewportWith(c.buffer);
        const r = new PriceAxisRenderer();
        expect(() => r.render(ctx, LAYOUT, viewport, DARK_THEME)).not.toThrow();
      });

      it('TimeAxisRenderer does not throw', () => {
        const { viewport } = buildViewportWith(c.buffer);
        const r = new TimeAxisRenderer();
        expect(() => r.render(ctx, LAYOUT, viewport, c.buffer, new TimeScaleBehavior('1H'), DARK_THEME)).not.toThrow();
      });

      it('CrosshairRenderer hidden does not throw', () => {
        const { viewport } = buildViewportWith(c.buffer);
        const r = new CrosshairRenderer();
        const state: CrosshairState = { x: 0, y: 0, price: 0, time: '', visible: false, inMainPane: true };
        expect(() => r.render(ctx, LAYOUT, viewport, state, DARK_THEME)).not.toThrow();
      });

      it('CrosshairRenderer visible does not throw', () => {
        const { viewport } = buildViewportWith(c.buffer);
        const r = new CrosshairRenderer();
        const state: CrosshairState = {
          x: LAYOUT.chartLeft + 100,
          y: LAYOUT.chartTop + 100,
          price: 100,
          time: '12:00',
          visible: true,
          inMainPane: true,
        };
        expect(() => r.render(ctx, LAYOUT, viewport, state, DARK_THEME)).not.toThrow();

        // Over a sub-pane: still renders (vertical line + time label only).
        const subPaneState: CrosshairState = { ...state, inMainPane: false };
        expect(() => r.render(ctx, LAYOUT, viewport, subPaneState, DARK_THEME)).not.toThrow();
      });

      it('PriceLineRenderer does not throw', () => {
        const { viewport } = buildViewportWith(c.buffer);
        const r = new PriceLineRenderer();
        expect(() => r.render(ctx, LAYOUT, viewport, 100, DARK_THEME)).not.toThrow();
      });

      it('LegendRenderer does not throw with null candle', () => {
        const r = new LegendRenderer();
        expect(() => r.render(ctx, LAYOUT, null, 'BTC/USDT', '1H', DARK_THEME)).not.toThrow();
      });

      it('LegendRenderer does not throw with a candle', () => {
        const r = new LegendRenderer();
        const candle = makeCandle(0);
        expect(() => r.render(ctx, LAYOUT, candle, 'BTC/USDT', '1H', DARK_THEME)).not.toThrow();
      });
    });
  }
});

describe('PriceAxisRenderer.drawCurrentPrice', () => {
  it('renders bull variant without throwing', () => {
    const buffer = fillBuffer(10);
    const viewport = new Viewport();
    viewport.setLayout(LAYOUT);
    viewport.scrollToEnd(buffer.length);
    viewport.autoScale(buffer);
    const r = new PriceAxisRenderer();
    const ctx = makeCtx();
    expect(() => r.drawCurrentPrice(ctx, LAYOUT, viewport, 100, true, DARK_THEME)).not.toThrow();
  });

  it('renders bear variant without throwing', () => {
    const buffer = fillBuffer(10);
    const viewport = new Viewport();
    viewport.setLayout(LAYOUT);
    viewport.scrollToEnd(buffer.length);
    viewport.autoScale(buffer);
    const r = new PriceAxisRenderer();
    const ctx = makeCtx();
    expect(() => r.drawCurrentPrice(ctx, LAYOUT, viewport, 100, false, DARK_THEME)).not.toThrow();
  });

  it('does nothing when price is outside chart area', () => {
    const buffer = fillBuffer(10);
    const viewport = new Viewport();
    viewport.setLayout(LAYOUT);
    viewport.autoScale(buffer);
    viewport.scrollToEnd(buffer.length);
    const r = new PriceAxisRenderer();
    const ctx = makeCtx();
    // Price far outside range should be silently skipped (no crash)
    expect(() => r.drawCurrentPrice(ctx, LAYOUT, viewport, 1_000_000, true, DARK_THEME)).not.toThrow();
  });
});

describe('GoToLiveRenderer', () => {
  it('render populates bounds, hide clears them', () => {
    const r = new GoToLiveRenderer();
    expect(r.getBounds()).toBeNull();

    const ctx = makeCtx();
    r.render(ctx, LAYOUT, DARK_THEME);
    const bounds = r.getBounds();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThan(0);
    expect(bounds!.height).toBeGreaterThan(0);

    r.hide();
    expect(r.getBounds()).toBeNull();
  });

  it('hitTest returns false when pill is hidden', () => {
    const r = new GoToLiveRenderer();
    expect(r.hitTest(100, 100)).toBe(false);
  });

  it('hitTest returns true for a point inside the rendered pill', () => {
    const r = new GoToLiveRenderer();
    r.render(makeCtx(), LAYOUT, DARK_THEME);
    const b = r.getBounds()!;
    expect(r.hitTest(b.x + b.width / 2, b.y + b.height / 2)).toBe(true);
  });

  it('hitTest returns false for a point outside the pill', () => {
    const r = new GoToLiveRenderer();
    r.render(makeCtx(), LAYOUT, DARK_THEME);
    expect(r.hitTest(0, 0)).toBe(false);
  });
});
