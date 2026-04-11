import { useEffect, useRef } from 'react';
import { OHLCVChart as CoreChart } from '@rekurt/ohlcv-core';
import type {
  Candle,
  ChartType,
  IndicatorConfig,
  LayoutState,
  ThemeMode,
} from '@rekurt/ohlcv-core';
import type { SymbolInfo, ResolutionInfo } from '@ohlcv-examples/shared';

interface CoreTabProps {
  symbol: SymbolInfo;
  resolution: ResolutionInfo;
  candles: Candle[];
  theme: ThemeMode;
  chartType: ChartType;
  indicators: IndicatorConfig[];
  registerShareFn: (fn: (() => LayoutState | null) | null) => void;
  initialState: LayoutState | null;
}

/**
 * Vanilla TS tab — uses @rekurt/ohlcv-core directly without any
 * framework wrapper. The imperative API is exercised in a React useEffect
 * host because the playground's outer shell happens to be React, but
 * nothing here touches React semantics — `new CoreChart(...)` gets a
 * DOM container and the tab manages the lifecycle manually.
 */
export function CoreTab(props: CoreTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<CoreChart | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = new CoreChart({
      container: containerRef.current,
      symbol: props.symbol.label,
      resolution: props.resolution.id,
      theme: props.theme,
      chartType: props.chartType,
    });
    chart.setData(props.candles);
    chart.setIndicatorConfigs(props.indicators);
    chartRef.current = chart;

    if (props.initialState) {
      chart.loadState(props.initialState);
    }

    props.registerShareFn(() => chart.saveLayoutState());

    return () => {
      props.registerShareFn(null);
      chart.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chartRef.current?.setData(props.candles, { preserveView: true });
  }, [props.candles]);

  useEffect(() => {
    chartRef.current?.setTheme(props.theme);
  }, [props.theme]);

  useEffect(() => {
    chartRef.current?.setChartType(props.chartType);
  }, [props.chartType]);

  useEffect(() => {
    chartRef.current?.setIndicatorConfigs(props.indicators);
  }, [props.indicators]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
