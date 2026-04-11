import { useRef, useEffect, useCallback } from 'react';
import {
  OHLCVChart,
  type ChartConfig,
  type Candle,
  type CandleBuffer,
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
 * Headless React hook for embedding an OHLCV chart without the
 * `<OHLCVChart>` component wrapper. Use when you want full control of
 * the container element (custom layout, overlays, non-rectangular
 * containers). The returned `containerRef` must be attached to a `div`
 * the hook can mount the canvas into.
 *
 * API parity with `<OHLCVChart>` — all imperative methods from the
 * component ref are returned here as stable callbacks.
 */
export function useOHLCVChart(options: UseOHLCVChartOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<OHLCVChart | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const config: ChartConfig = {
      container: containerRef.current,
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

    chartRef.current = new OHLCVChart(config);

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.transport]);

  // Stable callbacks — the chart instance may come and go across
  // transport changes, but external consumers keep the same refs.
  const setData = useCallback((candles: Candle[], opts?: { preserveView?: boolean }) => {
    chartRef.current?.setData(candles, opts);
  }, []);

  const updateLastCandle = useCallback((candle: Candle) => {
    chartRef.current?.updateLastCandle(candle);
  }, []);

  const setTheme = useCallback((theme: ThemeMode | ThemeColors) => {
    chartRef.current?.setTheme(theme);
  }, []);

  const setChartType = useCallback((type: ChartType) => {
    chartRef.current?.setChartType(type);
  }, []);

  const setIndicatorConfigs = useCallback((configs: IndicatorConfig[]) => {
    chartRef.current?.setIndicatorConfigs(configs);
  }, []);

  const setIdleCursor = useCallback((cursor: string | null) => {
    chartRef.current?.setIdleCursor(cursor);
  }, []);

  const switchSymbol = useCallback((symbol: string, resolution: string) => {
    chartRef.current?.switchSymbol(symbol, resolution);
  }, []);

  const goToLive = useCallback(() => chartRef.current?.goToLive(), []);
  const fitVisible = useCallback(() => chartRef.current?.fitVisible(), []);
  const fitAll = useCallback(() => chartRef.current?.fitAll(), []);

  const prependHistory = useCallback((older: Candle[]) => {
    chartRef.current?.prependHistory(older);
  }, []);

  const saveLayoutState = useCallback((): LayoutState | null => {
    return chartRef.current?.saveLayoutState() ?? null;
  }, []);
  const saveFullState = useCallback((): FullState | null => {
    return chartRef.current?.saveFullState() ?? null;
  }, []);
  const loadState = useCallback((state: LayoutState | FullState) => {
    chartRef.current?.loadState(state);
  }, []);

  const startDrawing = useCallback((tool: 'trendline' | 'hline') => {
    chartRef.current?.startDrawing(tool);
  }, []);
  const getDrawings = useCallback((): DrawingSnapshot[] => {
    return chartRef.current?.getDrawings() ?? [];
  }, []);
  const loadDrawings = useCallback((snaps: DrawingSnapshot[]) => {
    chartRef.current?.loadDrawings(snaps);
  }, []);
  const clearDrawings = useCallback(() => chartRef.current?.clearDrawings(), []);

  const toPNG = useCallback((): string | null => {
    return chartRef.current?.toPNG() ?? null;
  }, []);

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
