/**
 * Install a jsdom-compatible `HTMLCanvasElement.prototype.getContext` mock
 * so components that create real canvas elements (ChartEngine, OHLCVChart)
 * don't explode inside vitest. The stub returns a proxy that accepts every
 * method as a no-op and returns predictable values for `measureText` and
 * `getImageData`.
 *
 * Call once per test file in a `beforeAll` hook.
 */
export function installCanvasStub(): void {
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

  // Only install once per session.
  const proto = HTMLCanvasElement.prototype as HTMLCanvasElement & { __ohlcvPatched?: boolean };
  if (proto.__ohlcvPatched) return;
  proto.__ohlcvPatched = true;

  const original = proto.getContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (proto as any).getContext = function patchedGetContext(this: HTMLCanvasElement, type: string) {
    if (type === '2d') {
      return new Proxy({ canvas: this }, handler);
    }
    // eslint-disable-next-line prefer-rest-params
    return original?.apply(this, arguments as unknown as [string]) ?? null;
  };

  // ResizeObserver is not available in jsdom — provide a no-op impl.
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
