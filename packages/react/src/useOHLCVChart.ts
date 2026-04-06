import { useRef, useEffect, useCallback } from 'react';
import {
  OHLCVChart,
  type ChartConfig,
  type Candle,
  type ThemeMode,
  type ThemeColors,
} from '@ohlcv/core';

export interface UseOHLCVChartOptions {
  symbol: string;
  resolution: string;
  transport?: ChartConfig['transport'];
  theme?: ThemeMode | ThemeColors;
  priceFormat?: (price: number) => string;
  volumeFormat?: (volume: number) => string;
  onCandleClick?: (candle: Candle, index: number) => void;
  onVisibleRangeChange?: (from: number, to: number) => void;
}

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
      priceFormat: options.priceFormat,
      volumeFormat: options.volumeFormat,
      onCandleClick: options.onCandleClick,
      onVisibleRangeChange: options.onVisibleRangeChange,
    };

    chartRef.current = new OHLCVChart(config);

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.transport]);

  const setData = useCallback((candles: Candle[]) => {
    chartRef.current?.setData(candles);
  }, []);

  const updateLastCandle = useCallback((candle: Candle) => {
    chartRef.current?.updateLastCandle(candle);
  }, []);

  const setTheme = useCallback((theme: ThemeMode | ThemeColors) => {
    chartRef.current?.setTheme(theme);
  }, []);

  const switchSymbol = useCallback((symbol: string, resolution: string) => {
    chartRef.current?.switchSymbol(symbol, resolution);
  }, []);

  return {
    containerRef,
    chartRef,
    setData,
    updateLastCandle,
    setTheme,
    switchSymbol,
  };
}
