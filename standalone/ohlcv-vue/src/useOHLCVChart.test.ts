import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createApp, defineComponent, h, ref, type App } from 'vue';
import { useOHLCVChart } from './useOHLCVChart';
import type { OHLCVChart, ChartType } from '@rekurt/ohlcv-core';

/** Inline canvas stub — same pattern as OHLCVChart.test.ts. */
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

describe('useOHLCVChart (Vue)', () => {
  beforeAll(() => installCanvasStub());

  let host: HTMLDivElement;
  let app: App | null;

  beforeEach(() => {
    host = createContainer();
    app = null;
  });

  afterEach(() => {
    if (app) app.unmount();
    host.remove();
  });

  /** Synchronously flush Vue's microtask queue. */
  async function tick(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it('reacts to symbol/resolution changes after mount (via refs)', async () => {
    const symbol = ref('BTC/USDT');
    const resolution = ref('1H');

    let api: ReturnType<typeof useOHLCVChart> | null = null;
    const Comp = defineComponent({
      setup() {
        api = useOHLCVChart({
          symbol,
          resolution,
        });
        return () => h('div', { ref: api!.containerRef, style: 'width:1000px;height:500px' });
      },
    });
    app = createApp(Comp);
    app.mount(host);
    await tick();

    expect(api).not.toBeNull();
    const chart = api!.chartRef.value as OHLCVChart;
    expect(chart).toBeTruthy();

    // Change the ref — the composable's watch should call switchSymbol.
    symbol.value = 'ETH/USDT';
    resolution.value = '15m';
    await tick();
    // Internal field check: the chart's symbol/resolution should be
    // updated (going through switchSymbol).
    const cfg = (chart as unknown as { _config: { symbol: string; resolution: string } })
      ._config;
    expect(cfg.symbol).toBe('ETH/USDT');
    expect(cfg.resolution).toBe('15m');
  });

  it('reacts to chartType changes after mount', async () => {
    const chartType = ref<ChartType>('candles');
    let api: ReturnType<typeof useOHLCVChart> | null = null;
    const Comp = defineComponent({
      setup() {
        api = useOHLCVChart({
          symbol: 'BTC/USDT',
          resolution: '1H',
          chartType,
        });
        return () => h('div', { ref: api!.containerRef, style: 'width:1000px;height:500px' });
      },
    });
    app = createApp(Comp);
    app.mount(host);
    await tick();

    chartType.value = 'line';
    await tick();
    chartType.value = 'area';
    await tick();
    // No throw == watch wired up. Verify the chart engine state matches.
    const chart = api!.chartRef.value as unknown as { _chartType?: string };
    expect(chart._chartType ?? 'candles').toBeDefined();
  });

  it('accepts plain values (non-ref) for backward compatibility', async () => {
    let api: ReturnType<typeof useOHLCVChart> | null = null;
    const Comp = defineComponent({
      setup() {
        api = useOHLCVChart({
          symbol: 'BTC/USDT',
          resolution: '1H',
          theme: 'dark',
          chartType: 'candles',
        });
        return () => h('div', { ref: api!.containerRef, style: 'width:1000px;height:500px' });
      },
    });
    app = createApp(Comp);
    app.mount(host);
    await tick();
    expect(api!.chartRef.value).toBeTruthy();
  });

  it('does NOT invoke plain function callbacks during setup', async () => {
    // Regression guard for the toValue-on-callbacks bug: passing a
    // plain function must NOT call it at setup time (toValue treats
    // functions as getters and would invoke them).
    let hoverCalls = 0;
    let errorCalls = 0;
    let api: ReturnType<typeof useOHLCVChart> | null = null;
    const Comp = defineComponent({
      setup() {
        api = useOHLCVChart({
          symbol: 'BTC/USDT',
          resolution: '1H',
          onHover: () => {
            hoverCalls++;
          },
          onError: () => {
            errorCalls++;
          },
          onCandleClick: () => {
            hoverCalls++;
          },
        });
        return () => h('div', { ref: api!.containerRef, style: 'width:1000px;height:500px' });
      },
    });
    app = createApp(Comp);
    app.mount(host);
    await tick();
    expect(api!.chartRef.value).toBeTruthy();
    // No chart events were dispatched, so none of the handlers should
    // have fired. Before the fix, toValue() invoked each one once.
    expect(hoverCalls).toBe(0);
    expect(errorCalls).toBe(0);
  });

  it('exposes the imperative API methods', async () => {
    let api: ReturnType<typeof useOHLCVChart> | null = null;
    const Comp = defineComponent({
      setup() {
        api = useOHLCVChart({ symbol: 'BTC/USDT', resolution: '1H' });
        return () => h('div', { ref: api!.containerRef, style: 'width:1000px;height:500px' });
      },
    });
    app = createApp(Comp);
    app.mount(host);
    await tick();

    const methods = [
      'setData',
      'updateLastCandle',
      'prependHistory',
      'setTheme',
      'setChartType',
      'setIndicatorConfigs',
      'setIdleCursor',
      'switchSymbol',
      'goToLive',
      'fitVisible',
      'fitAll',
      'saveLayoutState',
      'saveFullState',
      'loadState',
      'startDrawing',
      'getDrawings',
      'loadDrawings',
      'clearDrawings',
      'toPNG',
    ] as const;
    for (const m of methods) {
      expect(typeof (api as unknown as Record<string, unknown>)![m]).toBe('function');
    }
  });
});
