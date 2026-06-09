import { defineComponent, h, ref, onMounted, onBeforeUnmount, watch, type PropType } from 'vue';
import {
  OHLCVChart as CoreChart,
  diffIndicatorConfigs,
  type DrawingTool,
  type Candle,
  type CandleBuffer,
  type ChartConfig,
  type ChartError,
  type ChartType,
  type DataTransport,
  type DrawingSnapshot,
  type Marker,
  type FullState,
  type HoverInfo,
  type IndicatorConfig,
  type LayoutState,
  type ThemeMode,
  type ThemeColors,
  type Messages,
} from '@rekurt/ohlcv-core';

/**
 * Vue 3 wrapper for the OHLCV chart. Reactive props for declarative
 * data + config, typed emits for events, and `defineExpose` for
 * imperative escape-hatch methods. Mirrors the React wrapper's
 * `<OHLCVChart>` and `OHLCVChartRef` surface 1:1.
 *
 * Indicators are reconciled through `diffIndicatorConfigs` (the same
 * pure function React uses) so both frameworks share identical
 * semantics. `v-model:indicators="myList"` is supported via the
 * `update:indicators` emit — the chart itself never currently emits
 * this event (configs are always controlled), but the syntax is live
 * for forward compatibility with future auto-removal behavior.
 */
export const OHLCVChart = defineComponent({
  name: 'OHLCVChart',
  props: {
    // Identity
    symbol: { type: String, required: true },
    resolution: { type: String, required: true },

    // Data
    transport: { type: Object as PropType<DataTransport>, default: undefined },
    data: { type: Array as PropType<Candle[]>, default: undefined },

    // Display
    theme: { type: [String, Object] as PropType<ThemeMode | ThemeColors>, default: 'dark' },
    chartType: { type: String as PropType<ChartType>, default: undefined },
    locale: { type: String, default: undefined },
    messages: { type: Object as PropType<Partial<Messages>>, default: undefined },
    priceFormat: { type: Function as PropType<(price: number) => string>, default: undefined },
    volumeFormat: { type: Function as PropType<(volume: number) => string>, default: undefined },
    idleCursor: { type: String as PropType<string | null>, default: undefined },

    // Declarative reconciled feature array
    indicators: { type: Array as PropType<IndicatorConfig[]>, default: undefined },
  },
  emits: {
    'hover': (_info: HoverInfo | null) => true,
    'candle-click': (_candle: Candle, _index: number) => true,
    'visible-range-change': (_from: number, _to: number) => true,
    'error': (_err: ChartError) => true,
    'load-more-history': (_buffer: CandleBuffer) => true,
    // Emitted on v-model:indicators. Never fired by core in M1, but
    // declared so Vue's template compiler accepts the syntax.
    'update:indicators': (_list: IndicatorConfig[]) => true,
  },
  setup(props, { emit, expose }) {
    const containerRef = ref<HTMLElement | null>(null);
    const chartRef = ref<CoreChart | null>(null);
    let initialSymbol = true;
    let prevIndicators: IndicatorConfig[] = [];

    function createChart() {
      if (!containerRef.value) return;
      destroyChart();

      const config: ChartConfig = {
        container: containerRef.value,
        symbol: props.symbol,
        resolution: props.resolution,
        transport: props.transport,
        theme: props.theme,
        chartType: props.chartType,
        locale: props.locale,
        messages: props.messages,
        priceFormat: props.priceFormat,
        volumeFormat: props.volumeFormat,
        onCandleClick: (candle, index) => emit('candle-click', candle, index),
        onVisibleRangeChange: (from, to) => emit('visible-range-change', from, to),
        onHover: (info) => emit('hover', info),
        onError: (err) => emit('error', err),
        onLoadMoreHistory: (buffer) => emit('load-more-history', buffer),
      };

      chartRef.value = new CoreChart(config);
      initialSymbol = true;
      prevIndicators = [];

      if (props.data) {
        chartRef.value.setData(props.data);
      }
      if (props.indicators && props.indicators.length > 0) {
        chartRef.value.setIndicatorConfigs(props.indicators);
        prevIndicators = props.indicators;
      }
      if (props.idleCursor !== undefined && props.idleCursor !== null) {
        chartRef.value.setIdleCursor(props.idleCursor);
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

    // Symbol / resolution — use switchSymbol() which fully resets the view.
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

    // Theme
    watch(
      () => props.theme,
      (theme) => {
        if (!chartRef.value || !theme) return;
        chartRef.value.setTheme(theme);
      },
    );

    // Chart type
    watch(
      () => props.chartType,
      (chartType) => {
        if (!chartRef.value || !chartType) return;
        chartRef.value.setChartType(chartType);
      },
    );

    // Data updates — preserve view so unrelated reactive changes don't
    // snap the viewport back to the live edge.
    watch(
      () => props.data,
      (data) => {
        if (!chartRef.value || !data) return;
        chartRef.value.setData(data, { preserveView: true });
      },
    );

    // Indicator reconciliation — only call setIndicatorConfigs when the
    // diff actually changed. Shares diff logic with React via core.
    watch(
      () => props.indicators,
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

    // Idle cursor
    watch(
      () => props.idleCursor,
      (cursor) => {
        if (!chartRef.value || cursor === undefined) return;
        chartRef.value.setIdleCursor(cursor);
      },
    );

    // Transport — full chart recreation.
    watch(
      () => props.transport,
      () => createChart(),
    );

    expose({
      // Direct chart ref escape hatch.
      chart: chartRef,

      // Navigation
      goToLive: () => chartRef.value?.goToLive(),
      fitVisible: () => chartRef.value?.fitVisible(),
      fitAll: () => chartRef.value?.fitAll(),

      // Data manipulation
      prependHistory: (olderCandles: Candle[]) =>
        chartRef.value?.prependHistory(olderCandles),
      updateLastCandle: (candle: Candle) => chartRef.value?.updateLastCandle(candle),

      // State persistence
      saveLayoutState: (): LayoutState | null =>
        chartRef.value?.saveLayoutState() ?? null,
      saveFullState: (): FullState | null =>
        chartRef.value?.saveFullState() ?? null,
      loadState: (state: LayoutState | FullState) => chartRef.value?.loadState(state),

      // Drawings
      startDrawing: (tool: DrawingTool) =>
        chartRef.value?.startDrawing(tool),
      getDrawings: (): DrawingSnapshot[] => chartRef.value?.getDrawings() ?? [],
      loadDrawings: (snapshots: DrawingSnapshot[]) =>
        chartRef.value?.loadDrawings(snapshots),
      clearDrawings: () => chartRef.value?.clearDrawings(),
      selectDrawingAt: (x: number, y: number, tolerance?: number): string | null =>
        chartRef.value?.selectDrawingAt(x, y, tolerance) ?? null,
      selectDrawing: (id: string | null) => chartRef.value?.selectDrawing(id),
      getSelectedDrawingId: (): string | null =>
        chartRef.value?.getSelectedDrawingId() ?? null,
      deleteSelectedDrawing: (): boolean =>
        chartRef.value?.deleteSelectedDrawing() ?? false,
      undoDrawing: (): boolean => chartRef.value?.undoDrawing() ?? false,
      redoDrawing: (): boolean => chartRef.value?.redoDrawing() ?? false,
      setMarkers: (markers: Marker[]) => chartRef.value?.setMarkers(markers),
      getMarkers: (): readonly Marker[] => chartRef.value?.getMarkers() ?? [],
      addMarker: (marker: Marker) => chartRef.value?.addMarker(marker),
      removeMarker: (id: string): boolean => chartRef.value?.removeMarker(id) ?? false,
      clearMarkers: () => chartRef.value?.clearMarkers(),

      // Export
      toPNG: (): string | null => chartRef.value?.toPNG() ?? null,
    });

    return () =>
      h('div', {
        ref: containerRef,
        style: { width: '100%', height: '100%' },
      });
  },
});
