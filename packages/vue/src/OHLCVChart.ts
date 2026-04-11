import { defineComponent, h, ref, onMounted, onBeforeUnmount, watch, type PropType } from 'vue';
import {
  OHLCVChart as CoreChart,
  type ChartConfig,
  type Candle,
  type DataTransport,
  type ThemeMode,
  type ThemeColors,
} from '@rekurt/ohlcv-core';

export const OHLCVChart = defineComponent({
  name: 'OHLCVChart',
  props: {
    symbol: { type: String, required: true },
    resolution: { type: String, required: true },
    transport: { type: Object as PropType<DataTransport>, default: undefined },
    data: { type: Array as PropType<Candle[]>, default: undefined },
    theme: { type: [String, Object] as PropType<ThemeMode | ThemeColors>, default: 'dark' },
    priceFormat: { type: Function as PropType<(price: number) => string>, default: undefined },
    volumeFormat: { type: Function as PropType<(volume: number) => string>, default: undefined },
  },
  emits: ['candle-click', 'visible-range-change'],
  setup(props, { emit, expose }) {
    const containerRef = ref<HTMLElement | null>(null);
    const chartRef = ref<CoreChart | null>(null);
    let initialSymbol = true;

    function createChart() {
      if (!containerRef.value) return;
      destroyChart();

      const config: ChartConfig = {
        container: containerRef.value,
        symbol: props.symbol,
        resolution: props.resolution,
        transport: props.transport,
        theme: props.theme,
        priceFormat: props.priceFormat,
        volumeFormat: props.volumeFormat,
        onCandleClick: (candle, index) => emit('candle-click', candle, index),
        onVisibleRangeChange: (from, to) => emit('visible-range-change', from, to),
      };

      chartRef.value = new CoreChart(config);
      initialSymbol = true;

      if (props.data) {
        chartRef.value.setData(props.data);
      }
    }

    function destroyChart() {
      if (chartRef.value) {
        chartRef.value.destroy();
        chartRef.value = null;
      }
    }

    onMounted(() => createChart());
    onBeforeUnmount(() => destroyChart());

    // Watch symbol/resolution changes
    watch(
      () => [props.symbol, props.resolution] as const,
      ([symbol, resolution]) => {
        if (!chartRef.value) return;
        if (initialSymbol) {
          initialSymbol = false;
          return;
        }
        chartRef.value.switchSymbol(symbol, resolution);
      },
    );

    // Watch theme changes
    watch(
      () => props.theme,
      (theme) => {
        if (!chartRef.value || !theme) return;
        chartRef.value.setTheme(theme);
      },
    );

    // Watch data changes. Use `preserveView: true` so re-renders caused
    // by unrelated reactive changes don't snap the viewport back to the
    // live edge. Genuine symbol/resolution changes are handled by the
    // separate watcher above which calls `switchSymbol()`.
    watch(
      () => props.data,
      (data) => {
        if (!chartRef.value || !data) return;
        chartRef.value.setData(data, { preserveView: true });
      },
    );

    // Watch transport changes
    watch(
      () => props.transport,
      () => createChart(),
    );

    expose({
      chart: chartRef,
    });

    return () =>
      h('div', {
        ref: containerRef,
        style: { width: '100%', height: '100%' },
      });
  },
});
