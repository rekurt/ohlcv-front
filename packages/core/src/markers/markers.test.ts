import { describe, it, expect } from 'vitest';
import { markerY, type Marker } from './Marker';
import { MarkerRenderer } from './MarkerRenderer';
import { Viewport } from '../interaction/Viewport';
import { CandleBuffer } from '../data/CandleBuffer';
import { computeLayout } from '../utils';
import { DARK_THEME } from '../constants';
import type { Candle, ChartLayout } from '../types';

const LAYOUT: ChartLayout = computeLayout(1000, 500);

function buildViewport(): Viewport {
  const vp = new Viewport();
  vp.setLayout(LAYOUT);
  vp.startIndex = 0;
  vp.priceMin = 50;
  vp.priceMax = 250;
  return vp;
}

const candle: Candle = { o: 150, h: 200, l: 100, c: 150, v: 1, t: 1000 };

describe('markerY', () => {
  const vp = buildViewport();

  it('places "above" markers above the candle high', () => {
    const m: Marker = { id: 'a', time: 1000, position: 'above' };
    expect(markerY(m, candle, vp, 6, 9)).toBeLessThan(vp.priceToY(candle.h));
  });

  it('places "below" markers below the candle low', () => {
    const m: Marker = { id: 'b', time: 1000, position: 'below' };
    expect(markerY(m, candle, vp, 6, 9)).toBeGreaterThan(vp.priceToY(candle.l));
  });

  it('places "inline" markers at the given price (or close)', () => {
    expect(markerY({ id: 'c', time: 1000, position: 'inline', price: 175 }, candle, vp, 6, 9))
      .toBeCloseTo(vp.priceToY(175));
    expect(markerY({ id: 'd', time: 1000, position: 'inline' }, candle, vp, 6, 9))
      .toBeCloseTo(vp.priceToY(candle.c));
  });

  it('defaults to "above" when no position is given', () => {
    const m: Marker = { id: 'e', time: 1000 };
    expect(markerY(m, candle, vp, 6, 9)).toBeLessThan(vp.priceToY(candle.h));
  });
});

function recordingCtx(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(t, prop: string) {
      if (prop === 'measureText') return (s: string) => ({ width: s.length * 6 });
      if (prop in t) return t[prop];
      return (..._args: unknown[]) => {
        calls.push(prop);
      };
    },
    set(t, prop: string, value: unknown) {
      t[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('MarkerRenderer', () => {
  function bufferOf(times: number[]): CandleBuffer {
    const b = new CandleBuffer();
    times.forEach((t) => b.append({ o: 150, h: 200, l: 100, c: 150, v: 1, t }));
    return b;
  }

  it('draws a glyph for a marker whose candle exists', () => {
    const { ctx, calls } = recordingCtx();
    const buffer = bufferOf([1000, 1060, 1120]);
    new MarkerRenderer().render(
      ctx, LAYOUT, buildViewport(), buffer,
      [{ id: 'm1', time: 1060, shape: 'circle' }], DARK_THEME,
    );
    expect(calls).toContain('arc'); // circle glyph
  });

  it('skips markers whose timestamp matches no candle', () => {
    const { ctx, calls } = recordingCtx();
    const buffer = bufferOf([1000, 1060]);
    new MarkerRenderer().render(
      ctx, LAYOUT, buildViewport(), buffer,
      [{ id: 'm1', time: 99999, shape: 'circle' }], DARK_THEME,
    );
    expect(calls).not.toContain('arc');
  });

  it('renders a text label when provided', () => {
    const { ctx, calls } = recordingCtx();
    const buffer = bufferOf([1000]);
    new MarkerRenderer().render(
      ctx, LAYOUT, buildViewport(), buffer,
      [{ id: 'm1', time: 1000, shape: 'arrowUp', text: 'BUY' }], DARK_THEME,
    );
    expect(calls).toContain('fillText');
  });

  it('is a no-op for an empty marker list', () => {
    const { ctx, calls } = recordingCtx();
    new MarkerRenderer().render(
      ctx, LAYOUT, buildViewport(), bufferOf([1000]), [], DARK_THEME,
    );
    expect(calls).toHaveLength(0);
  });

  // Г3c: during replay the buffer still physically holds bars past the cap, so
  // a marker anchored to a not-yet-revealed bar must be hidden. The engine
  // passes maxVisibleIndex() as `maxIndex`; a marker whose index exceeds it
  // draws no glyph.
  it('hides a marker anchored to a bar past the replay cap (maxIndex)', () => {
    const buffer = bufferOf([1000, 1060, 1120, 1180]);
    // Marker on bar index 3 (time 1180). Reveal only bars 0..1 → maxIndex = 1.
    const marker: Marker = { id: 'm1', time: 1180, shape: 'circle' };

    const hidden = recordingCtx();
    new MarkerRenderer().render(
      hidden.ctx, LAYOUT, buildViewport(), buffer, [marker], DARK_THEME, /* maxIndex */ 1,
    );
    expect(hidden.calls).not.toContain('arc'); // past the cap → no glyph

    // Sanity: with the cap lifted (default Infinity) the same marker draws,
    // proving the suppression is the maxIndex gate and not a bad fixture.
    const shown = recordingCtx();
    new MarkerRenderer().render(
      shown.ctx, LAYOUT, buildViewport(), buffer, [marker], DARK_THEME,
    );
    expect(shown.calls).toContain('arc');
  });
});
