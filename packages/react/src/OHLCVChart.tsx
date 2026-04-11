import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import {
  OHLCVChart as CoreChart,
  type ChartConfig,
  type Candle,
  type DataTransport,
  type ThemeMode,
  type ThemeColors,
} from '@rekurt/ohlcv-core';

export interface OHLCVChartProps {
  symbol: string;
  resolution: string;
  transport?: DataTransport;
  data?: Candle[];
  theme?: ThemeMode | ThemeColors;
  locale?: string;
  priceFormat?: (price: number) => string;
  volumeFormat?: (volume: number) => string;
  onCandleClick?: (candle: Candle, index: number) => void;
  onVisibleRangeChange?: (from: number, to: number) => void;
  className?: string;
  style?: React.CSSProperties;
}

export interface OHLCVChartRef {
  chart: CoreChart | null;
}

export const OHLCVChart = forwardRef<OHLCVChartRef, OHLCVChartProps>(function OHLCVChart(props, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<CoreChart | null>(null);
  const initialSymbolRef = useRef(true);

  useImperativeHandle(ref, () => ({
    get chart() {
      return chartRef.current;
    },
  }));

  // Create/destroy chart when transport changes
  useEffect(() => {
    if (!containerRef.current) return;

    const config: ChartConfig = {
      container: containerRef.current,
      symbol: props.symbol,
      resolution: props.resolution,
      transport: props.transport,
      theme: props.theme,
      locale: props.locale,
      priceFormat: props.priceFormat,
      volumeFormat: props.volumeFormat,
      onCandleClick: props.onCandleClick,
      onVisibleRangeChange: props.onVisibleRangeChange,
    };

    chartRef.current = new CoreChart(config);
    initialSymbolRef.current = true;

    // Load initial data if provided
    if (props.data) {
      chartRef.current.setData(props.data);
    }

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.transport]);

  // Switch symbol/resolution
  useEffect(() => {
    if (!chartRef.current) return;
    // Skip first call — constructor already connected
    if (initialSymbolRef.current) {
      initialSymbolRef.current = false;
      return;
    }
    chartRef.current.switchSymbol(props.symbol, props.resolution);
  }, [props.symbol, props.resolution]);

  // Theme updates
  useEffect(() => {
    if (!chartRef.current || !props.theme) return;
    chartRef.current.setTheme(props.theme);
  }, [props.theme]);

  // Data updates. Use `preserveView: true` so that re-renders caused by
  // unrelated state changes (hover, indicator selection, theme) don't
  // snap the viewport back to the live edge. A genuine symbol/resolution
  // switch goes through `switchSymbol()` which fully resets.
  useEffect(() => {
    if (!chartRef.current || !props.data) return;
    chartRef.current.setData(props.data, { preserveView: true });
  }, [props.data]);

  return (
    <div
      ref={containerRef}
      className={props.className}
      style={{ width: '100%', height: '100%', ...props.style }}
    />
  );
});
