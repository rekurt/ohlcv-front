// Main facade
export { OHLCVChart } from './OHLCVChart';
export type { DrawingTool } from './OHLCVChart';

// Types
export type {
  Candle,
  CandleView,
  DataFeedConfig,
  HistoryRequest,
  DataTransport,
  ThemeColors,
  ThemeMode,
  ChartConfig,
  ChartLayout,
  ChartError,
  ChartErrorWhere,
  ChartType,
  HoverInfo,
} from './types';

// Error reporting
export { ErrorReporter } from './ErrorReporter';

// Data layer
export { CandleBuffer } from './data/CandleBuffer';
export { CandleMerger } from './data/CandleMerger';
export { DataFeed } from './data/DataFeed';
export { PollingTransport } from './data/PollingTransport';
export type { PollingTransportConfig } from './data/PollingTransport';
export { WebSocketTransport } from './data/WebSocketTransport';
export { ExponentialBackoff } from './data/ExponentialBackoff';
export type { ExponentialBackoffOptions } from './data/ExponentialBackoff';
export { ValidationError, validateCandle, validateCandles } from './data/validation';
export { findGaps, resolutionToSeconds } from './data/gaps';
export type { CandleGap } from './data/gaps';

// Rendering
export { ChartEngine } from './rendering/ChartEngine';
export { GoToLiveRenderer } from './rendering/GoToLiveRenderer';
export type { GoToLiveBounds } from './rendering/GoToLiveRenderer';
export { Pane, PaneLayout } from './rendering/Pane';
export type { PaneKind, YScale } from './rendering/Pane';

// State persistence
export type { ChartState, LayoutState, FullState } from './state/ChartState';
export { isFullState } from './state/ChartState';
export {
  CURRENT_STATE_VERSION,
  migrateState,
  migrations,
  type StateMigration,
} from './state/migrations';

// Indicators
export { Indicator, nanArray } from './indicators/Indicator';
export type { IndicatorPlacement, IndicatorSeries } from './indicators/Indicator';
export {
  createIndicator,
  indicatorId,
  diffIndicatorConfigs,
} from './indicators/registry';
export type { IndicatorConfig, IndicatorDiff } from './indicators/registry';
export { SMA } from './indicators/SMA';
export { EMA } from './indicators/EMA';
export { BollingerBands } from './indicators/BollingerBands';
export { RSI } from './indicators/RSI';
export { MACD } from './indicators/MACD';
export { Stochastic } from './indicators/Stochastic';
export { ATR } from './indicators/ATR';
export { VWAP } from './indicators/VWAP';
export type { VWAPAnchor } from './indicators/VWAP';
export { WilliamsR } from './indicators/WilliamsR';
export { OBV } from './indicators/OBV';
export { ADX } from './indicators/ADX';
export { CCI } from './indicators/CCI';
export { PivotPoints } from './indicators/PivotPoints';
export { Ichimoku } from './indicators/Ichimoku';
export { MFI } from './indicators/MFI';
export { WMA } from './indicators/WMA';
export { HMA } from './indicators/HMA';
export { Donchian } from './indicators/Donchian';
export { Keltner } from './indicators/Keltner';
export { Supertrend } from './indicators/Supertrend';
export { ParabolicSAR } from './indicators/ParabolicSAR';
export { StochRSI } from './indicators/StochRSI';
export { ROC } from './indicators/ROC';
export { ZigZag } from './indicators/ZigZag';

// Alternative chart-type renderers (opt-in, not wired into ChartEngine yet)
export { LineRenderer } from './rendering/LineRenderer';
export { AreaRenderer } from './rendering/AreaRenderer';
export { OHLCBarRenderer } from './rendering/OHLCBarRenderer';
export { HeikinAshiRenderer } from './rendering/HeikinAshiRenderer';

// Drawing tools
export { Drawing } from './drawings/Drawing';
export type { AnchorPoint, DrawingSnapshot } from './drawings/Drawing';
export { TrendLine } from './drawings/TrendLine';
export { HorizontalLine } from './drawings/HorizontalLine';
export { Rectangle } from './drawings/Rectangle';
export { Ray } from './drawings/Ray';
export { VerticalLine } from './drawings/VerticalLine';
export { FibRetracement } from './drawings/FibRetracement';
export { FibExtension } from './drawings/FibExtension';
export { Channel } from './drawings/Channel';
export { Arrow } from './drawings/Arrow';
export { DrawingLayer } from './drawings/DrawingLayer';

// Markers (candle-anchored point annotations)
export { markerY } from './markers/Marker';
export type { Marker, MarkerPosition, MarkerShape } from './markers/Marker';
export { MarkerRenderer } from './markers/MarkerRenderer';

// Data transforms (Heikin Ashi, Renko)
export { toHeikinAshi, advanceHeikinAshi } from './transforms/heikinAshi';
export { toRenko } from './transforms/renko';

// Interaction
export { Viewport } from './interaction/Viewport';
export type { GridTick } from './interaction/Viewport';
export { priceToTransformed, transformedToPrice, LOG_MIN_POSITIVE } from './interaction/priceScale';
export type { PriceScaleMode } from './interaction/priceScale';
export { PanZoomController } from './interaction/PanZoomController';
export { CrosshairController } from './interaction/CrosshairController';
export { KeyboardController } from './interaction/KeyboardController';
export type { KeyboardCallbacks } from './interaction/KeyboardController';

// Constants & Utilities
export { DARK_THEME, LIGHT_THEME } from './constants';
export { resolveTheme, formatPrice, formatVolume, formatPercent, formatTime, computeLayout } from './utils';
