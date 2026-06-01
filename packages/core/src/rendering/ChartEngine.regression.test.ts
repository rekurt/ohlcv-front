import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ChartEngine } from './ChartEngine';
import { CandleBuffer } from '../data/CandleBuffer';
import { DARK_THEME } from '../constants';
import type { Candle } from '../types';

/**
 * Cross-cutting REGRESSION GUARD.
 *
 * Records the exact sequence of canvas operations the default render path
 * emits (candles + linear price scale + no conflation + no primitives) and
 * pins it with an inline snapshot. Every engine-touching refactor in the
 * LWC-parity work (F1 identity transform, F2 conflation bypass, F3
 * switch→registry, F4 primitive z-tiers) MUST leave this snapshot
 * byte-identical. If it changes, the diff is the proof that "default path
 * unchanged" was violated — review intentionally before updating.
 *
 * The recording context caches one proxy per canvas (mirroring real
 * browsers, where repeated getContext('2d') returns the same object) so
 * the chart layer's ops accumulate in a single array.
 */

interface Recording {
  canvas: HTMLCanvasElement;
  ops: string[];
}

let recordings: Recording[] = [];
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

function fmt(v: unknown): string {
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    if (!Number.isFinite(v)) return String(v);
    return v.toFixed(3);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  return String(v);
}

function installRecordingStub(): void {
  const proto = HTMLCanvasElement.prototype as HTMLCanvasElement & {
    __recordingCtx?: WeakMap<HTMLCanvasElement, { proxy: unknown; ops: string[] }>;
  };
  originalGetContext = proto.getContext;
  const ctxByCanvas = new WeakMap<HTMLCanvasElement, { proxy: unknown; ops: string[] }>();
  proto.__recordingCtx = ctxByCanvas;

  function makeProxy(canvas: HTMLCanvasElement, ops: string[]): unknown {
    const target: Record<string, unknown> = { canvas };
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(t, prop: string) {
        if (prop === 'measureText') return (text: string) => ({ width: text.length * 6 });
        if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
        if (prop === 'createLinearGradient') {
          return () => ({ addColorStop: () => undefined });
        }
        if (prop === 'canvas') return t.canvas;
        if (prop in t) return t[prop];
        return (...args: unknown[]) => {
          ops.push(`${prop}(${args.map(fmt).join(',')})`);
          return undefined;
        };
      },
      set(t, prop: string, value: unknown) {
        ops.push(`${String(prop)}=${fmt(value)}`);
        t[prop] = value;
        return true;
      },
    };
    return new Proxy(target, handler);
  }

  (proto as unknown as { getContext: unknown }).getContext = function patched(
    this: HTMLCanvasElement,
    type: string,
  ) {
    if (type !== '2d') return null;
    const existing = ctxByCanvas.get(this);
    if (existing) return existing.proxy;
    const ops: string[] = [];
    const proxy = makeProxy(this, ops);
    ctxByCanvas.set(this, { proxy, ops });
    recordings.push({ canvas: this, ops });
    return proxy;
  };

  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof NoopResizeObserver }).ResizeObserver =
      NoopResizeObserver;
  }
}

function makeCandle(i: number): Candle {
  // Deterministic, varied closes so candles/grid/axis all emit real ops.
  const c = 100 + Math.sin(i / 4) * 8 + i * 0.05;
  const o = 100 + Math.sin((i - 1) / 4) * 8 + (i - 1) * 0.05;
  const h = Math.max(o, c) + 1.5;
  const l = Math.min(o, c) - 1.5;
  return { o, h, l, c, v: 1000 + (i % 7) * 120, t: 1_700_000_000 + i * 3600 };
}

function forceRender(engine: ChartEngine): void {
  (engine as unknown as { _render: () => void })._render();
}

describe('ChartEngine default-path regression guard', () => {
  beforeAll(() => {
    installRecordingStub();
  });

  afterAll(() => {
    const proto = HTMLCanvasElement.prototype as HTMLCanvasElement & { __ohlcvPatched?: boolean };
    (proto as unknown as { getContext: unknown }).getContext = originalGetContext;
  });

  function buildDefaultChart(): { engine: ChartEngine; chartOps: string[]; uiOps: string[] } {
    recordings = [];
    const container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({ width: 1000, height: 500, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, toJSON() {} }) as DOMRect;
    document.body.appendChild(container);

    const engine = new ChartEngine(container, DARK_THEME);
    engine.setSymbol('BTC/USDT');
    engine.setResolution('1H');

    const buffer = new CandleBuffer();
    for (let i = 0; i < 60; i++) buffer.append(makeCandle(i));
    engine.setBuffer(buffer);
    engine.viewport.scrollToEnd(buffer.length);

    // Clear any construction-time ops, then render the default path once.
    for (const r of recordings) r.ops.length = 0;
    forceRender(engine);

    // recordings[0] = chart layer, [1] = ui layer, [2] = crosshair layer
    // (creation order in the constructor).
    const chartOps = recordings[0]?.ops ?? [];
    const uiOps = recordings[1]?.ops ?? [];
    return { engine, chartOps, uiOps };
  }

  it('emits a stable chart-layer op sequence (candles + linear + no conflation)', () => {
    const { engine, chartOps } = buildDefaultChart();
    expect(chartOps.length).toBeGreaterThan(0);
    // Sanity anchors that must always hold for the candles path:
    expect(chartOps.some((o) => o.startsWith('clearRect('))).toBe(true);
    expect(chartOps.some((o) => o.startsWith('fillRect('))).toBe(true); // candle bodies + bg
    expect(chartOps).toMatchSnapshot('chart-layer');
    engine.destroy();
  });

  it('emits a stable ui-layer op sequence (price line + current-price pill + legend)', () => {
    const { engine, uiOps } = buildDefaultChart();
    expect(uiOps.length).toBeGreaterThan(0);
    expect(uiOps).toMatchSnapshot('ui-layer');
    engine.destroy();
  });
});
