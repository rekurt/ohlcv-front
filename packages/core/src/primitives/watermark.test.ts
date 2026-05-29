import { describe, it, expect } from 'vitest';
import { WatermarkPrimitive } from './WatermarkPrimitive';
import { Viewport } from '../interaction/Viewport';
import { computeLayout } from '../utils';
import { DARK_THEME } from '../constants';
import type { ChartLayout } from '../types';

const LAYOUT: ChartLayout = computeLayout(1000, 500);

interface Op {
  type: 'call' | 'set';
  name: string;
  args?: unknown[];
  value?: unknown;
}

function makeCtx(): CanvasRenderingContext2D & { __ops: Op[]; __props: Record<string, unknown> } {
  const ops: Op[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(
    {},
    {
      get(_t, p: string) {
        if (p === '__ops') return ops;
        if (p === '__props') return props;
        if (p === 'measureText') return (t: string) => ({ width: t.length * 6 });
        if (p in props) return props[p];
        return (...args: unknown[]) => {
          ops.push({ type: 'call', name: p, args });
        };
      },
      set(_t, p: string, v: unknown) {
        props[p] = v;
        ops.push({ type: 'set', name: p, value: v });
        return true;
      },
    },
  );
  return ctx as unknown as CanvasRenderingContext2D & { __ops: Op[]; __props: Record<string, unknown> };
}

const vp = new Viewport();
vp.setLayout(LAYOUT);

describe('WatermarkPrimitive', () => {
  it('is a bottom-tier primitive', () => {
    expect(new WatermarkPrimitive('w', { text: 'BTC' }).zOrder).toBe('bottom');
  });

  it('draws text with globalAlpha set and restored', () => {
    const ctx = makeCtx();
    new WatermarkPrimitive('w', { text: 'BTC/USDT' }).draw(ctx, LAYOUT, vp, DARK_THEME);
    const names = ctx.__ops.map((o) => `${o.type}:${o.name}`);
    expect(names).toContain('call:save');
    expect(names).toContain('call:restore');
    expect(names).toContain('call:fillText');
    // save precedes restore
    expect(names.indexOf('call:save')).toBeLessThan(names.indexOf('call:restore'));
    // default opacity applied
    const alphaSet = ctx.__ops.find((o) => o.type === 'set' && o.name === 'globalAlpha');
    expect(alphaSet?.value).toBeCloseTo(0.1, 6);
    const fillText = ctx.__ops.find((o) => o.name === 'fillText');
    expect(fillText?.args?.[0]).toBe('BTC/USDT');
  });

  it('positions center vs topLeft differently (align/baseline)', () => {
    const center = makeCtx();
    new WatermarkPrimitive('w', { text: 'X', position: 'center' }).draw(center, LAYOUT, vp, DARK_THEME);
    const topLeft = makeCtx();
    new WatermarkPrimitive('w', { text: 'X', position: 'topLeft' }).draw(topLeft, LAYOUT, vp, DARK_THEME);

    expect(center.__props.textAlign).toBe('center');
    expect(center.__props.textBaseline).toBe('middle');
    expect(topLeft.__props.textAlign).toBe('left');
    expect(topLeft.__props.textBaseline).toBe('top');

    const cText = center.__ops.find((o) => o.name === 'fillText');
    const tText = topLeft.__ops.find((o) => o.name === 'fillText');
    expect(cText?.args?.[1]).not.toBe(tText?.args?.[1]); // different x
  });

  it('clamps opacity: >1 → 1, <=0 → no draw', () => {
    const high = makeCtx();
    new WatermarkPrimitive('w', { text: 'X', opacity: 5 }).draw(high, LAYOUT, vp, DARK_THEME);
    const alpha = high.__ops.find((o) => o.type === 'set' && o.name === 'globalAlpha');
    expect(alpha?.value).toBe(1);

    const zero = makeCtx();
    new WatermarkPrimitive('w', { text: 'X', opacity: 0 }).draw(zero, LAYOUT, vp, DARK_THEME);
    expect(zero.__ops.find((o) => o.name === 'save')).toBeUndefined(); // bailed early
  });

  it('draws a ready image without throwing', () => {
    const ctx = makeCtx();
    const image = { width: 120, height: 40 } as unknown as CanvasImageSource;
    expect(() =>
      new WatermarkPrimitive('w', { image, position: 'bottomRight' }).draw(ctx, LAYOUT, vp, DARK_THEME),
    ).not.toThrow();
    expect(ctx.__ops.some((o) => o.name === 'drawImage')).toBe(true);
  });

  it('skips an incomplete HTMLImageElement-like source', () => {
    const ctx = makeCtx();
    const image = { width: 120, height: 40, complete: false } as unknown as CanvasImageSource;
    new WatermarkPrimitive('w', { image }).draw(ctx, LAYOUT, vp, DARK_THEME);
    expect(ctx.__ops.some((o) => o.name === 'drawImage')).toBe(false);
  });

  it('setOptions replaces the rendered content', () => {
    const wm = new WatermarkPrimitive('w', { text: 'OLD' });
    wm.setOptions({ text: 'NEW' });
    const ctx = makeCtx();
    wm.draw(ctx, LAYOUT, vp, DARK_THEME);
    const fillText = ctx.__ops.find((o) => o.name === 'fillText');
    expect(fillText?.args?.[0]).toBe('NEW');
  });
});
