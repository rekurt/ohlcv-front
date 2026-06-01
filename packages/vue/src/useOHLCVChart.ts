import {
  ref,
  onMounted,
  onBeforeUnmount,
  watch,
  toValue,
  type Ref,
  type MaybeRefOrGetter,
} from 'vue';
import {
  OHLCVChart,
  diffIndicatorConfigs,
  type DrawingTool,
  type Candle,
  type CandleBuffer,
  type ChartConfig,
  type ChartError,
  type ChartType,
  type DrawingSnapshot,
  type FullState,
  type HoverInfo,
  type IndicatorConfig,
  type LayoutState,
  type ThemeMode,
  type ThemeColors,
  type Messages,
} from '@rekurt/ohlcv-core';

export interface UseOHLCVChartOptions {
  symbol: MaybeRefOrGetter<string>;
  resolution: MaybeRefOrGetter<string>;
  transport?: MaybeRefOrGetter<ChartConfig['transport'] | undefined>;
  theme?: MaybeRefOrGetter<ThemeMode | ThemeColors | undefined>;
  chartType?: MaybeRefOrGetter<ChartType | undefined>;
  locale?: MaybeRefOrGetter<string | undefined>;
  /** Translatable UI string overrides (C6). Falls back to English defaults. */
  messages?: MaybeRefOrGetter<Partial<Messages> | undefined>;
  idleCursor?: MaybeRefOrGetter<string | null | undefined>;
  indicators?: MaybeRefOrGetter<IndicatorConfig[] | undefined>;
  priceFormat?: (price: number) => string;
  volumeFormat?: (volume: number) => string;
  // Callbacks are PLAIN functions, never MaybeRefOrGetter. In Vue's
  // Composition API `setup()` runs once, so the `options` object and
  // its function references are stable for the component's lifetime —
  // there's no re-render churn to guard against (unlike React). The
  // config closures below read `options.onX` live at call time, so a
  // reassignment to the same options object would also be picked up.
  // (Wrapping callbacks in `toValue` would be a bug: toValue treats a
  // function as a getter and invokes it immediately, losing the
  // handler — see PR #1 review.)
  onCandleClick?: (candle: Candle, index: number) => void;
  onVisibleRangeChange?: (from: number, to: number) => void;
  onHover?: (info: HoverInfo | null) => void;
  onError?: (err: ChartError) => void;
  onLoadMoreHistory?: (buffer: CandleBuffer) => void | Promise<void>;
}

/**
 * Headless Vue composable. Gives you a `containerRef` to attach to any
 * element plus the full imperative API of the chart. Use when the
 * `<OHLCVChart>` component's default layout doesn't fit (custom wrappers,
 * non-rectangular containers, SSR hydration edge cases).
 *
 * All reactive props accept `MaybeRefOrGetter<T>` — plain values, refs,
 * computed refs, or getter functions. The composable watches each one
 * and applies changes incrementally (no full chart recreation, except
 * when `transport` changes). Callback props are also reactive — passing
 * a new arrow function on re-render swaps the live handler without
 * tearing down the chart.
 *
 * API parity with `<OHLCVChart>` defineExpose — same method names and
 * signatures as the React `useOHLCVChart` hook.
 */
export function useOHLCVChart(options: UseOHLCVChartOptions) {
  const containerRef = ref<HTMLElement | null>(null) as Ref<HTMLElement | null>;
  const chartRef = ref<OHLCVChart | null>(null) as Ref<OHLCVChart | null>;
  let prevIndicators: IndicatorConfig[] = [];
  // Set to true while createChart() is running and for the same tick
  // afterward, so the symbol/resolution watcher doesn't ALSO call
  // switchSymbol when a transport change recreated the chart in the
  // same tick (which would reconnect twice).
  let justRecreated = false;

  function createChart() {
    if (!containerRef.value) return;
    destroyChart();

    const config: ChartConfig = {
      container: containerRef.value,
      symbol: toValue(options.symbol),
      resolution: toValue(options.resolution),
      transport: toValue(options.transport),
      theme: toValue(options.theme),
      chartType: toValue(options.chartType),
      locale: toValue(options.locale),
      messages: toValue(options.messages),
      priceFormat: options.priceFormat,
      volumeFormat: options.volumeFormat,
      // Delegate to options.onX live — `options` is stable for the
      // component's lifetime (setup runs once), so this always calls
      // the current handler without any toValue/watcher machinery.
      onCandleClick: (candle, index) => options.onCandleClick?.(candle, index),
      onVisibleRangeChange: (from, to) => options.onVisibleRangeChange?.(from, to),
      onHover: (info) => options.onHover?.(info),
      onError: (err) => options.onError?.(err),
      onLoadMoreHistory: (buffer) => options.onLoadMoreHistory?.(buffer),
    };

    chartRef.value = new OHLCVChart(config);
    prevIndicators = [];

    const initialIndicators = toValue(options.indicators);
    if (initialIndicators && initialIndicators.length > 0) {
      chartRef.value.setIndicatorConfigs(initialIndicators);
      prevIndicators = initialIndicators;
    }
    const initialIdle = toValue(options.idleCursor);
    if (initialIdle !== undefined && initialIdle !== null) {
      chartRef.value.setIdleCursor(initialIdle);
    }
  }

  function destroyChart() {
    chartRef.value?.destroy();
    chartRef.value = null;
  }

  onMounted(() => createChart());
  onBeforeUnmount(() => destroyChart());

  // Identity — switchSymbol() resets the view. Vue 3 `watch` does not
  // fire on initial setup by default, so we don't need to skip a
  // synthetic first invocation. We DO skip when the chart was just
  // recreated by a transport change in the same tick — the new chart
  // already connected with the current symbol/resolution.
  //
  // The transport watcher is registered FIRST (above this one) so that
  // when transport + symbol both change in the same flush, the
  // recreation runs before this watcher checks `justRecreated`.
  watch(
    () => toValue(options.transport),
    () => {
      justRecreated = true;
      createChart();
      void Promise.resolve().then(() => {
        justRecreated = false;
      });
    },
  );

  watch(
    () => [toValue(options.symbol), toValue(options.resolution)] as const,
    ([symbol, resolution]) => {
      if (!chartRef.value) return;
      if (justRecreated) return;
      chartRef.value.switchSymbol(symbol, resolution);
    },
  );

  watch(
    () => toValue(options.theme),
    (theme) => {
      if (!chartRef.value || !theme) return;
      chartRef.value.setTheme(theme);
    },
  );

  watch(
    () => toValue(options.chartType),
    (chartType) => {
      if (!chartRef.value || !chartType) return;
      chartRef.value.setChartType(chartType);
    },
  );

  watch(
    () => toValue(options.indicators),
    (next) => {
      if (!chartRef.value) return;
      const nextList = next ?? [];
      const diff = diffIndicatorConfigs(prevIndicators, nextList);
      if (diff.changed) {
        chartRef.value.setIndicatorConfigs(nextList);
      }
      prevIndicators = nextList;
    },
  );

  watch(
    () => toValue(options.idleCursor),
    (cursor) => {
      if (!chartRef.value || cursor === undefined) return;
      chartRef.value.setIdleCursor(cursor);
    },
  );

  // Data
  function setData(candles: Candle[], opts?: { preserveView?: boolean }) {
    chartRef.value?.setData(candles, opts);
  }
  function updateLastCandle(candle: Candle) {
    chartRef.value?.updateLastCandle(candle);
  }
  function prependHistory(older: Candle[]) {
    chartRef.value?.prependHistory(older);
  }

  // Display
  function setTheme(theme: ThemeMode | ThemeColors) {
    chartRef.value?.setTheme(theme);
  }
  function setChartType(type: ChartType) {
    chartRef.value?.setChartType(type);
  }
  function setIndicatorConfigs(configs: IndicatorConfig[]) {
    chartRef.value?.setIndicatorConfigs(configs);
    prevIndicators = configs;
  }
  function setIdleCursor(cursor: string | null) {
    chartRef.value?.setIdleCursor(cursor);
  }

  // Identity
  function switchSymbol(symbol: string, resolution: string) {
    chartRef.value?.switchSymbol(symbol, resolution);
  }

  // Navigation
  function goToLive() {
    chartRef.value?.goToLive();
  }
  function fitVisible() {
    chartRef.value?.fitVisible();
  }
  function fitAll() {
    chartRef.value?.fitAll();
  }

  // State persistence
  function saveLayoutState(): LayoutState | null {
    return chartRef.value?.saveLayoutState() ?? null;
  }
  function saveFullState(): FullState | null {
    return chartRef.value?.saveFullState() ?? null;
  }
  function loadState(state: LayoutState | FullState) {
    chartRef.value?.loadState(state);
  }

  // Drawings
  function startDrawing(tool: DrawingTool) {
    chartRef.value?.startDrawing(tool);
  }
  function getDrawings(): DrawingSnapshot[] {
    return chartRef.value?.getDrawings() ?? [];
  }
  function loadDrawings(snaps: DrawingSnapshot[]) {
    chartRef.value?.loadDrawings(snaps);
  }
  function clearDrawings() {
    chartRef.value?.clearDrawings();
  }

  // Export
  function toPNG(): string | null {
    return chartRef.value?.toPNG() ?? null;
  }

  return {
    containerRef,
    chartRef,
    // Data
    setData,
    updateLastCandle,
    prependHistory,
    // Display
    setTheme,
    setChartType,
    setIndicatorConfigs,
    setIdleCursor,
    // Identity
    switchSymbol,
    // Navigation
    goToLive,
    fitVisible,
    fitAll,
    // State persistence
    saveLayoutState,
    saveFullState,
    loadState,
    // Drawings
    startDrawing,
    getDrawings,
    loadDrawings,
    clearDrawings,
    // Export
    toPNG,
  };
}
