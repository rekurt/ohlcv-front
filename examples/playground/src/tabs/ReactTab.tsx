import { useEffect, useRef } from 'react';
import { OHLCVChart, type OHLCVChartRef } from '@rekurt/ohlcv-react';
import type {
  Candle,
  ChartType,
  IndicatorConfig,
  LayoutState,
  ThemeMode,
} from '@rekurt/ohlcv-core';

interface ReactTabProps {
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
 * React tab — uses the declarative `<OHLCVChart>` component from the
 * @rekurt/ohlcv-react package. The tab is idiomatically "controlled":
 * every toolbar state in the App is a prop here, and the chart
 * re-reconciles via the wrapper's useEffect handlers.
 */
export function ReactTab(props: ReactTabProps) {
  const chartRef = useRef<OHLCVChartRef>(null);

  // Register a share function that produces LayoutState on demand.
  useEffect(() => {
    props.registerShareFn(() => chartRef.current?.saveLayoutState() ?? null);
    return () => props.registerShareFn(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply initial state once after mount.
  useEffect(() => {
    if (!props.initialState || !chartRef.current) return;
    chartRef.current.loadState(props.initialState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <OHLCVChart
        ref={chartRef}
        symbol={props.symbol}
        resolution={props.resolution}
        data={props.candles}
        theme={props.theme}
        chartType={props.chartType}
        indicators={props.indicators}
      />
    </div>
  );
}
