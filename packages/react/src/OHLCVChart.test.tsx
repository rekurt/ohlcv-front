import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createRef } from 'react';
import { OHLCVChart, type OHLCVChartRef } from './OHLCVChart';

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
 * Smoke tests for the React wrapper. We mount the component into a
 * jsdom container, poke at its imperative ref, and verify that props
 * changes propagate through to the underlying core chart. Not a full
 * Testing Library suite — the wrapper is thin enough that direct
 * inspection through `ref.chart` is the clearest check.
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

describe('React <OHLCVChart>', () => {
  beforeAll(() => {
    installCanvasStub();
  });

  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = createContainer();
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('mounts and creates a core chart instance', () => {
    const ref = createRef<OHLCVChartRef>();
    act(() => {
      root.render(<OHLCVChart ref={ref} symbol="BTC/USDT" resolution="1H" />);
    });
    expect(ref.current).toBeTruthy();
    expect(ref.current?.chart).toBeTruthy();
  });

  it('exposes all imperative methods on the ref', () => {
    const ref = createRef<OHLCVChartRef>();
    act(() => {
      root.render(<OHLCVChart ref={ref} symbol="BTC/USDT" resolution="1H" />);
    });
    const api = ref.current!;
    expect(typeof api.goToLive).toBe('function');
    expect(typeof api.fitVisible).toBe('function');
    expect(typeof api.fitAll).toBe('function');
    expect(typeof api.prependHistory).toBe('function');
    expect(typeof api.updateLastCandle).toBe('function');
    expect(typeof api.saveLayoutState).toBe('function');
    expect(typeof api.saveFullState).toBe('function');
    expect(typeof api.loadState).toBe('function');
    expect(typeof api.startDrawing).toBe('function');
    expect(typeof api.getDrawings).toBe('function');
    expect(typeof api.loadDrawings).toBe('function');
    expect(typeof api.clearDrawings).toBe('function');
    expect(typeof api.toPNG).toBe('function');
  });

  it('reconciles indicators array changes via diff', () => {
    const ref = createRef<OHLCVChartRef>();
    act(() => {
      root.render(
        <OHLCVChart
          ref={ref}
          symbol="BTC/USDT"
          resolution="1H"
          indicators={[{ type: 'sma', period: 20 }]}
        />,
      );
    });
    expect(ref.current!.chart!.getIndicators()).toHaveLength(1);

    // Change the prop — wrapper should call setIndicatorConfigs.
    act(() => {
      root.render(
        <OHLCVChart
          ref={ref}
          symbol="BTC/USDT"
          resolution="1H"
          indicators={[
            { type: 'sma', period: 20 },
            { type: 'ema', period: 50 },
          ]}
        />,
      );
    });
    expect(ref.current!.chart!.getIndicators()).toHaveLength(2);

    // Drop to zero — should clear.
    act(() => {
      root.render(
        <OHLCVChart
          ref={ref}
          symbol="BTC/USDT"
          resolution="1H"
          indicators={[]}
        />,
      );
    });
    expect(ref.current!.chart!.getIndicators()).toHaveLength(0);
  });

  it('round-trips saveLayoutState / loadState through the ref', () => {
    const ref = createRef<OHLCVChartRef>();
    act(() => {
      root.render(
        <OHLCVChart
          ref={ref}
          symbol="BTC/USDT"
          resolution="1H"
          chartType="line"
          indicators={[{ type: 'rsi', period: 14 }]}
        />,
      );
    });
    const state = ref.current!.saveLayoutState();
    expect(state).toBeTruthy();
    expect(state!.chartType).toBe('line');
    expect(state!.indicators).toEqual([{ type: 'rsi', period: 14 }]);
    expect(() => ref.current!.loadState(state!)).not.toThrow();
  });
});
