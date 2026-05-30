import { describe, it, expect } from 'vitest';
import { TimeScaleBehavior } from './TimeScaleBehavior';
import { PriceScaleBehavior } from './PriceScaleBehavior';
import {
  createHorzScaleBehavior,
  listHorzScaleBehaviors,
  registerHorzScaleBehavior,
} from './registry';
import { TimeAxisRenderer } from '../rendering/TimeAxis';
import { Viewport } from '../interaction/Viewport';
import { CandleBuffer } from '../data/CandleBuffer';
import { computeLayout, formatTime, formatPrice } from '../utils';
import { DARK_THEME } from '../constants';
import type { Candle, ChartLayout } from '../types';

const LAYOUT: ChartLayout = computeLayout(1000, 500);

function makeCandle(i: number): Candle {
  const base = 100 + i;
  return { o: base, h: base + 1, l: base - 1, c: base, v: 10, t: 1_700_000_000 + i * 3600 };
}

function fillBuffer(n: number): CandleBuffer {
  const buf = new CandleBuffer();
  for (let i = 0; i < n; i++) buf.append(makeCandle(i));
  return buf;
}

function recordingCtx(): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const texts: string[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(
    {},
    {
      get(_t, p: string) {
        if (p === 'fillText') return (label: string) => texts.push(label);
        if (p === 'measureText') return (t: string) => ({ width: t.length * 6 });
        if (p in props) return props[p];
        return () => undefined;
      },
      set(_t, p: string, v: unknown) {
        props[p] = v;
        return true;
      },
    },
  );
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

describe('TimeScaleBehavior', () => {
  it('is uniform', () => {
    expect(new TimeScaleBehavior('1H').uniform).toBe(true);
  });

  it('fromLogical returns the candle time, or null out of range', () => {
    const buf = fillBuffer(10);
    const b = new TimeScaleBehavior('1H');
    expect(b.fromLogical(3, buf)).toBe(buf.candleAt(3)!.t);
    expect(b.fromLogical(99, buf)).toBeNull();
    expect(b.fromLogical(-1, buf)).toBeNull();
  });

  it('formatValue matches formatTime at the active resolution', () => {
    const b = new TimeScaleBehavior('1D');
    const t = 1_700_000_000;
    expect(b.formatValue(t)).toBe(formatTime(t, '1D'));
    b.setResolution('1H');
    expect(b.formatValue(t)).toBe(formatTime(t, '1H'));
  });

  it('toLogical round-trips through findIndexByTime', () => {
    const buf = fillBuffer(10);
    const b = new TimeScaleBehavior('1H');
    const t = buf.candleAt(4)!.t;
    expect(b.toLogical(t, buf)).toBe(4);
  });
});

describe('PriceScaleBehavior', () => {
  it('formats the domain value as a price', () => {
    const b = new PriceScaleBehavior();
    expect(b.formatValue(1700000000)).toBe(formatPrice(1700000000));
    expect(b.formatValue(42.5)).toBe(formatPrice(42.5));
  });

  it('accepts a custom formatter', () => {
    const b = new PriceScaleBehavior((v) => `$${v.toFixed(0)}`);
    expect(b.formatValue(123.4)).toBe('$123');
  });

  it('fromLogical returns the strike stored in the t field', () => {
    const buf = fillBuffer(5);
    const b = new PriceScaleBehavior();
    expect(b.fromLogical(2, buf)).toBe(buf.candleAt(2)!.t);
  });
});

describe('horzscale registry', () => {
  it('creates built-in time and price behaviors', () => {
    expect(createHorzScaleBehavior('time')).toBeInstanceOf(TimeScaleBehavior);
    expect(createHorzScaleBehavior('price')).toBeInstanceOf(PriceScaleBehavior);
    expect(createHorzScaleBehavior('nope')).toBeUndefined();
    expect(listHorzScaleBehaviors()).toEqual(expect.arrayContaining(['time', 'price']));
  });

  it('registers a custom behavior factory', () => {
    registerHorzScaleBehavior('test:custom', () => new PriceScaleBehavior());
    expect(createHorzScaleBehavior('test:custom')).toBeInstanceOf(PriceScaleBehavior);
  });
});

describe('TimeAxisRenderer with horizontal-scale behavior', () => {
  function setup() {
    const buf = fillBuffer(60);
    const vp = new Viewport();
    vp.setLayout(LAYOUT);
    vp.scrollToEnd(buf.length);
    vp.autoScale(buf);
    return { buf, vp };
  }

  it('labels via TimeScaleBehavior identically to formatTime', () => {
    const { buf, vp } = setup();
    const { ctx, texts } = recordingCtx();
    new TimeAxisRenderer().render(ctx, LAYOUT, vp, buf, new TimeScaleBehavior('1H'), DARK_THEME);
    expect(texts.length).toBeGreaterThan(0);
    // Every emitted label is a formatTime output (HH:MM for 1H), never a price.
    for (const label of texts) {
      expect(label).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it('labels via PriceScaleBehavior as formatted prices (options-style X)', () => {
    const { buf, vp } = setup();
    const { ctx, texts } = recordingCtx();
    new TimeAxisRenderer().render(ctx, LAYOUT, vp, buf, new PriceScaleBehavior(), DARK_THEME);
    expect(texts.length).toBeGreaterThan(0);
    // t holds big numbers → formatPrice gives a 2-decimal string, not HH:MM.
    for (const label of texts) {
      expect(label).toMatch(/^\d+\.\d{2}$/);
    }
  });
});
