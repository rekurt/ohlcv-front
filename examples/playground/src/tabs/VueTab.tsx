import { useEffect, useRef } from 'react';
import { createApp, h, reactive, type App } from 'vue';
import { OHLCVChart as VueOHLCVChart } from '@rekurt/ohlcv-vue';
import type {
  Candle,
  ChartType,
  IndicatorConfig,
  LayoutState,
  ThemeMode,
} from '@rekurt/ohlcv-core';

interface VueTabProps {
  symbol: string;
  resolution: string;
  candles: Candle[];
  theme: ThemeMode;
  chartType: ChartType;
  indicators: IndicatorConfig[];
  registerShareFn: (fn: (() => LayoutState | null) | null) => void;
  initialState: LayoutState | null;
}

/**
 * Vue tab — mounts a Vue 3 app into a React-owned DOM node. The React
 * host only manages the div lifecycle; the Vue app inside owns its own
 * reactivity graph, so toolbar changes flow from React props →
 * `reactive()` state → Vue render → `<OHLCVChart>` props.
 *
 * `vueChartRef` is a Vue ref pointing at the chart component's exposed
 * methods (the `defineExpose` surface). We read `saveLayoutState` from
 * it to produce the share state.
 */
export function VueTab(props: VueTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const vueAppRef = useRef<App | null>(null);
  // Reactive bridge that the inner Vue component watches. Mutating any
  // of these fields updates the Vue chart.
  const bridgeRef = useRef<{
    symbol: string;
    resolution: string;
    candles: Candle[];
    theme: ThemeMode;
    chartType: ChartType;
    indicators: IndicatorConfig[];
  } | null>(null);
  const vueChartInstanceRef = useRef<{ saveLayoutState?: () => LayoutState | null; loadState?: (s: LayoutState) => void } | null>(
    null,
  );

  // Mount Vue app once.
  useEffect(() => {
    if (!containerRef.current) return;

    const bridge = reactive({
      symbol: props.symbol,
      resolution: props.resolution,
      candles: props.candles,
      theme: props.theme,
      chartType: props.chartType,
      indicators: props.indicators,
    });
    bridgeRef.current = bridge;

    const InnerComponent = {
      setup() {
        const chartRef: { value: unknown } = { value: null };
        return () =>
          h(VueOHLCVChart as unknown as ReturnType<typeof h> & { [key: string]: unknown }, {
            ref: (v: unknown) => {
              chartRef.value = v;
              vueChartInstanceRef.current = v as {
                saveLayoutState?: () => LayoutState | null;
                loadState?: (s: LayoutState) => void;
              };
            },
            symbol: bridge.symbol,
            resolution: bridge.resolution,
            data: bridge.candles,
            theme: bridge.theme,
            chartType: bridge.chartType,
            indicators: bridge.indicators,
          });
      },
    };

    const app = createApp(InnerComponent);
    app.mount(containerRef.current);
    vueAppRef.current = app;

    if (props.initialState) {
      // defer one tick so the chart ref is populated
      queueMicrotask(() => {
        vueChartInstanceRef.current?.loadState?.(props.initialState!);
      });
    }

    props.registerShareFn(
      () => vueChartInstanceRef.current?.saveLayoutState?.() ?? null,
    );

    return () => {
      props.registerShareFn(null);
      app.unmount();
      vueAppRef.current = null;
      bridgeRef.current = null;
      vueChartInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Propagate React prop changes into the Vue bridge.
  useEffect(() => {
    if (!bridgeRef.current) return;
    bridgeRef.current.symbol = props.symbol;
    bridgeRef.current.resolution = props.resolution;
    bridgeRef.current.candles = props.candles;
    bridgeRef.current.theme = props.theme;
    bridgeRef.current.chartType = props.chartType;
    bridgeRef.current.indicators = props.indicators;
  }, [
    props.symbol,
    props.resolution,
    props.candles,
    props.theme,
    props.chartType,
    props.indicators,
  ]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
