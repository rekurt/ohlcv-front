import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createApp, h, ref as vueRef, type App } from 'vue';
import { OHLCVChart } from './OHLCVChart';
import type { IndicatorConfig } from '@rekurt/ohlcv-core';

/** Minimal inline canvas stub for jsdom — no cross-package imports. */
function installCanvasStub(): void {
  const proto = HTMLCanvasElement.prototype as HTMLCanvasElement & {
    __ohlcvPatched?: boolean;
  };
  if (proto.__ohlcvPatched) return;
  proto.__ohlcvPatched = true;
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop: string) {
      if (prop === 'measureText') return (text: string) => ({ width: text.length * 6 });
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (prop === 'canvas') return target['canvas'];
      if (prop in target) return target[prop];
      return () => undefined;
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      return true;
    },
  };
  const original = proto.getContext;
  (proto as unknown as { getContext: unknown }).getContext = function patchedGetContext(
    this: HTMLCanvasElement,
    type: string,
  ) {
    if (type === '2d') return new Proxy({ canvas: this }, handler);
    // eslint-disable-next-line prefer-rest-params
    return original?.apply(this, arguments as unknown as [string]) ?? null;
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

/**
 * Smoke tests for the Vue wrapper. We mount the component with a
 * createApp/plain DOM host and poke at `defineExpose` via a template
 * ref. Not a full Vue Test Utils suite — the wrapper is thin enough
 * that direct inspection through `ref.chart` gives us the same
 * confidence.
 */

function createContainer(): HTMLDivElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({
      width: 1000,
      height: 500,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 500,
      toJSON() {},
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

describe('Vue <OHLCVChart>', () => {
  beforeAll(() => {
    installCanvasStub();
  });

  let host: HTMLDivElement;
  let app: App | null;

  beforeEach(() => {
    host = createContainer();
    app = null;
  });

  afterEach(() => {
    app?.unmount();
    host.remove();
  });

  function mountWithProps(props: Record<string, unknown>) {
    // Captured via template ref (chart instance is inside the ref'd component).
    const chartRef = vueRef<unknown>(null);

    // Casting OHLCVChart to a generic component here — Vue's h() overloads
    // are strict about typed props, and the test only cares that the
    // component mounts and exposes its API surface.
    const OHLCVChartAny = OHLCVChart as unknown as Parameters<typeof h>[0];
    app = createApp({
      render: () => h(OHLCVChartAny, { ref: chartRef, ...props }),
    });
    app.mount(host);
    return chartRef;
  }

  it('mounts and creates a core chart instance', () => {
    const r = mountWithProps({ symbol: 'BTC/USDT', resolution: '1H' });
    // chartRef points at the wrapper component — the chart itself is
    // reached through the `chart` accessor on defineExpose.
    const exposed = r.value as unknown as {
      chart: { value?: unknown } | null;
    };
    expect(exposed.chart).toBeTruthy();
  });

  it('exposes all imperative methods', () => {
    const r = mountWithProps({ symbol: 'BTC/USDT', resolution: '1H' });
    const api = r.value as unknown as Record<string, unknown>;
    const methods = [
      'goToLive',
      'fitVisible',
      'fitAll',
      'prependHistory',
      'updateLastCandle',
      'saveLayoutState',
      'saveFullState',
      'loadState',
      'startDrawing',
      'getDrawings',
      'loadDrawings',
      'clearDrawings',
      'toPNG',
    ];
    for (const m of methods) {
      expect(typeof api[m]).toBe('function');
    }
  });

  it('accepts indicators prop on initial mount', () => {
    const r = mountWithProps({
      symbol: 'BTC/USDT',
      resolution: '1H',
      indicators: [
        { type: 'sma', period: 20 },
        { type: 'ema', period: 50 },
      ] satisfies IndicatorConfig[],
    });
    const exposed = r.value as unknown as {
      saveLayoutState: () => { indicators: IndicatorConfig[] };
    };
    const state = exposed.saveLayoutState();
    expect(state.indicators).toHaveLength(2);
  });

  it('round-trips saveLayoutState / loadState through expose', () => {
    const r = mountWithProps({
      symbol: 'BTC/USDT',
      resolution: '1H',
      chartType: 'area',
      indicators: [{ type: 'rsi', period: 14 }],
    });
    const api = r.value as unknown as {
      saveLayoutState: () => { version: number; chartType: string; indicators: unknown[] } | null;
      loadState: (s: unknown) => void;
    };
    const state = api.saveLayoutState();
    expect(state).toBeTruthy();
    expect(state!.version).toBe(1);
    expect(state!.chartType).toBe('area');
    expect(state!.indicators).toEqual([{ type: 'rsi', period: 14 }]);
    expect(() => api.loadState(state!)).not.toThrow();
  });
});
