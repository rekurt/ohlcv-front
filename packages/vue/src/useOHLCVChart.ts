import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue';
import {
  OHLCVChart,
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
} from '@rekurt/ohlcv-core';

export interface UseOHLCVChartOptions {
  symbol: string;
  resolution: string;
  transport?: ChartConfig['transport'];
  theme?: ThemeMode | ThemeColors;
  chartType?: ChartType;
  locale?: string;
  priceFormat?: (price: number) => string;
  volumeFormat?: (volume: number) => string;
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
 * API parity with `<OHLCVChart>` defineExpose — same method names and
 * signatures as the React `useOHLCVChart` hook.
 */
export function useOHLCVChart(options: UseOHLCVChartOptions) {
  const containerRef = ref<HTMLElement | null>(null) as Ref<HTMLElement | null>;
  const chartRef = ref<OHLCVChart | null>(null) as Ref<OHLCVChart | null>;

  onMounted(() => {
    if (!containerRef.value) return;

    const config: ChartConfig = {
      container: containerRef.value,
      symbol: options.symbol,
      resolution: options.resolution,
      transport: options.transport,
      theme: options.theme,
      chartType: options.chartType,
      locale: options.locale,
      priceFormat: options.priceFormat,
      volumeFormat: options.volumeFormat,
      onCandleClick: options.onCandleClick,
      onVisibleRangeChange: options.onVisibleRangeChange,
      onHover: options.onHover,
      onError: options.onError,
      onLoadMoreHistory: options.onLoadMoreHistory,
    };

    chartRef.value = new OHLCVChart(config);
  });

  onBeforeUnmount(() => {
    chartRef.value?.destroy();
    chartRef.value = null;
  });

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
  function startDrawing(tool: 'trendline' | 'hline') {
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
