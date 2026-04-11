import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue';
import {
  OHLCVChart,
  type ChartConfig,
  type Candle,
  type ThemeMode,
  type ThemeColors,
} from '@rekurt/ohlcv-core';

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
      priceFormat: options.priceFormat,
      volumeFormat: options.volumeFormat,
      onCandleClick: options.onCandleClick,
      onVisibleRangeChange: options.onVisibleRangeChange,
    };

    chartRef.value = new OHLCVChart(config);
  });

  onBeforeUnmount(() => {
    chartRef.value?.destroy();
    chartRef.value = null;
  });

  function setData(candles: Candle[]) {
    chartRef.value?.setData(candles);
  }

  function updateLastCandle(candle: Candle) {
    chartRef.value?.updateLastCandle(candle);
  }

  function setTheme(theme: ThemeMode | ThemeColors) {
    chartRef.value?.setTheme(theme);
  }

  function switchSymbol(symbol: string, resolution: string) {
    chartRef.value?.switchSymbol(symbol, resolution);
  }

  return {
    containerRef,
    chartRef,
    setData,
    updateLastCandle,
    setTheme,
    switchSymbol,
  };
}
