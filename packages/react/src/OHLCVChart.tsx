import { useEffect, useRef, forwardRef, useImperativeHandle, type CSSProperties } from 'react';
import {
  OHLCVChart as CoreChart,
  diffIndicatorConfigs,
  type DrawingTool,
  type ChartConfig,
  type Candle,
  type CandleBuffer,
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
} from '@rekurt/ohlcv-core';

export interface OHLCVChartProps {
  // Identity
  symbol: string;
  resolution: string;

  // Data sources (transport has priority if both set)
  transport?: DataTransport;
  data?: Candle[];

  // Display config
  theme?: ThemeMode | ThemeColors;
  chartType?: ChartType;
  locale?: string;
  priceFormat?: (price: number) => string;
  volumeFormat?: (volume: number) => string;
  idleCursor?: string | null;

  // Declarative reconciled feature array
  indicators?: IndicatorConfig[];

  // Callbacks (core → user code)
  onHover?: (info: HoverInfo | null) => void;
  onCandleClick?: (candle: Candle, index: number) => void;
  onVisibleRangeChange?: (from: number, to: number) => void;
  onError?: (err: ChartError) => void;
  onLoadMoreHistory?: (buffer: CandleBuffer) => void | Promise<void>;

  // Styling
  className?: string;
  style?: CSSProperties;
}

/**
 * Imperative escape hatch for actions that do not fit the declarative
 * props model (navigation, state persistence, interactive drawing
 * workflows, canvas export). Mirrors the Vue wrapper's `defineExpose`
 * surface 1:1.
 */
export interface OHLCVChartRef {
  /** Direct access to the underlying core chart for advanced cases. */
  readonly chart: CoreChart | null;

  // Navigation
  goToLive(): void;
  fitVisible(): void;
  fitAll(): void;

  // Data manipulation
  prependHistory(olderCandles: Candle[]): void;
  updateLastCandle(candle: Candle): void;

  // State persistence
  saveLayoutState(): LayoutState | null;
  saveFullState(): FullState | null;
  loadState(state: LayoutState | FullState): void;

  // Drawings (imperative — interactive workflow, not declarative data)
  startDrawing(tool: DrawingTool): void;
  getDrawings(): DrawingSnapshot[];
  loadDrawings(snapshots: DrawingSnapshot[]): void;
  clearDrawings(): void;
  selectDrawingAt(x: number, y: number, tolerance?: number): string | null;
  selectDrawing(id: string | null): void;
  getSelectedDrawingId(): string | null;
  deleteSelectedDrawing(): boolean;
  undoDrawing(): boolean;
  redoDrawing(): boolean;

  // Markers
  setMarkers(markers: Marker[]): void;
  getMarkers(): readonly Marker[];
  addMarker(marker: Marker): void;
  removeMarker(id: string): boolean;
  clearMarkers(): void;

  // Export
  toPNG(): string | null;
}

const EMPTY_INDICATORS: IndicatorConfig[] = [];

export const OHLCVChart = forwardRef<OHLCVChartRef, OHLCVChartProps>(function OHLCVChart(
  props,
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<CoreChart | null>(null);
  const initialSymbolRef = useRef(true);
  const prevIndicatorsRef = useRef<IndicatorConfig[]>([]);

  // Callback trampoline refs. Core holds a single stable function at
  // construct time, but we want the latest closure to fire — otherwise
  // a user component re-render with a new onClick handler ships a
  // stale callback into core until the transport changes.
  const onCandleClickRef = useRef(props.onCandleClick);
  const onVisibleRangeChangeRef = useRef(props.onVisibleRangeChange);
  const onErrorRef = useRef(props.onError);
  const onLoadMoreHistoryRef = useRef(props.onLoadMoreHistory);
  // Keep them in sync on every render. Not wrapped in useEffect —
  // refs read by async core callbacks, not by React's reconciliation.
  onCandleClickRef.current = props.onCandleClick;
  onVisibleRangeChangeRef.current = props.onVisibleRangeChange;
  onErrorRef.current = props.onError;
  onLoadMoreHistoryRef.current = props.onLoadMoreHistory;

  // Create/destroy chart when transport changes.
  useEffect(() => {
    if (!containerRef.current) return;

    // Build the config with trampoline callbacks so the latest user
    // handler always fires, even after the user's parent component
    // re-renders with a new closure identity.
    const config: ChartConfig = {
      container: containerRef.current,
      symbol: props.symbol,
      resolution: props.resolution,
      transport: props.transport,
      theme: props.theme,
      locale: props.locale,
      priceFormat: props.priceFormat,
      volumeFormat: props.volumeFormat,
      chartType: props.chartType,
      onCandleClick: (candle, index) => onCandleClickRef.current?.(candle, index),
      onVisibleRangeChange: (from, to) => onVisibleRangeChangeRef.current?.(from, to),
      onHover: props.onHover,
      onError: (err) => onErrorRef.current?.(err),
      onLoadMoreHistory: (buffer) => onLoadMoreHistoryRef.current?.(buffer),
    };

    const chart = new CoreChart(config);
    chartRef.current = chart;
    initialSymbolRef.current = true;
    prevIndicatorsRef.current = [];

    if (props.data) {
      chart.setData(props.data);
    }
    if (props.indicators && props.indicators.length > 0) {
      chart.setIndicatorConfigs(props.indicators);
      prevIndicatorsRef.current = props.indicators;
    }
    if (props.idleCursor !== undefined && props.idleCursor !== null) {
      chart.setIdleCursor(props.idleCursor);
    }

    return () => {
      chart.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.transport]);

  // Switch symbol/resolution through the dedicated method (fully resets
  // the view); this is distinct from prop-driven data updates below.
  useEffect(() => {
    if (!chartRef.current) return;
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

  // chartType updates
  useEffect(() => {
    if (!chartRef.current || !props.chartType) return;
    chartRef.current.setChartType(props.chartType);
  }, [props.chartType]);

  // Data updates — always use `preserveView: true` so re-renders caused
  // by unrelated state (hover, indicator toggle, theme swap) don't snap
  // the viewport back to the live edge.
  useEffect(() => {
    if (!chartRef.current || !props.data) return;
    chartRef.current.setData(props.data, { preserveView: true });
  }, [props.data]);

  // Indicator reconciliation. Only call setIndicatorConfigs when the
  // diff changes — reference-stable arrays do nothing.
  useEffect(() => {
    if (!chartRef.current) return;
    const next = props.indicators ?? EMPTY_INDICATORS;
    const diff = diffIndicatorConfigs(prevIndicatorsRef.current, next);
    if (diff.changed) {
      chartRef.current.setIndicatorConfigs(next);
    }
    prevIndicatorsRef.current = next;
  }, [props.indicators]);

  // Idle cursor for drawing-tool affordance.
  useEffect(() => {
    if (!chartRef.current || props.idleCursor === undefined) return;
    chartRef.current.setIdleCursor(props.idleCursor);
  }, [props.idleCursor]);

  // Hover callback may change by identity on every render. Re-register
  // through the core API so the latest closure is live.
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.setOnHover(props.onHover ?? null);
  }, [props.onHover]);

  useImperativeHandle(
    ref,
    () => ({
      get chart() {
        return chartRef.current;
      },
      goToLive: () => chartRef.current?.goToLive(),
      fitVisible: () => chartRef.current?.fitVisible(),
      fitAll: () => chartRef.current?.fitAll(),
      prependHistory: (olderCandles: Candle[]) =>
        chartRef.current?.prependHistory(olderCandles),
      updateLastCandle: (candle: Candle) => chartRef.current?.updateLastCandle(candle),
      saveLayoutState: () => chartRef.current?.saveLayoutState() ?? null,
      saveFullState: () => chartRef.current?.saveFullState() ?? null,
      loadState: (state: LayoutState | FullState) => chartRef.current?.loadState(state),
      startDrawing: (tool: DrawingTool) =>
        chartRef.current?.startDrawing(tool),
      getDrawings: () => chartRef.current?.getDrawings() ?? [],
      loadDrawings: (snapshots: DrawingSnapshot[]) =>
        chartRef.current?.loadDrawings(snapshots),
      clearDrawings: () => chartRef.current?.clearDrawings(),
      selectDrawingAt: (x: number, y: number, tolerance?: number) =>
        chartRef.current?.selectDrawingAt(x, y, tolerance) ?? null,
      selectDrawing: (id: string | null) => chartRef.current?.selectDrawing(id),
      getSelectedDrawingId: () => chartRef.current?.getSelectedDrawingId() ?? null,
      deleteSelectedDrawing: () => chartRef.current?.deleteSelectedDrawing() ?? false,
      undoDrawing: () => chartRef.current?.undoDrawing() ?? false,
      redoDrawing: () => chartRef.current?.redoDrawing() ?? false,
      setMarkers: (markers: Marker[]) => chartRef.current?.setMarkers(markers),
      getMarkers: () => chartRef.current?.getMarkers() ?? [],
      addMarker: (marker: Marker) => chartRef.current?.addMarker(marker),
      removeMarker: (id: string) => chartRef.current?.removeMarker(id) ?? false,
      clearMarkers: () => chartRef.current?.clearMarkers(),
      toPNG: () => chartRef.current?.toPNG() ?? null,
    }),
    [],
  );

  return (
    <div
      ref={containerRef}
      className={props.className}
      style={{ width: '100%', height: '100%', ...props.style }}
    />
  );
});
