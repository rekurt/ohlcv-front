// Main facade
export { OHLCVChart } from './OHLCVChart';

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
export { BinanceWsTransport } from './data/BinanceWsTransport';
export type { BinanceWsTransportOptions, IWebSocketLike } from './data/BinanceWsTransport';
export { ExponentialBackoff } from './data/ExponentialBackoff';
export type { ExponentialBackoffOptions } from './data/ExponentialBackoff';
export { ValidationError, validateCandle, validateCandles } from './data/validation';

// Rendering
export { ChartEngine } from './rendering/ChartEngine';
export { GoToLiveRenderer } from './rendering/GoToLiveRenderer';
export type { GoToLiveBounds } from './rendering/GoToLiveRenderer';
export { Pane, PaneLayout } from './rendering/Pane';
export type { PaneKind, YScale } from './rendering/Pane';

// State persistence
export type { ChartState, LayoutState, FullState } from './state/ChartState';
export { isFullState } from './state/ChartState';

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

// Alternative chart-type renderers (opt-in, not wired into ChartEngine yet)
export { LineRenderer } from './rendering/LineRenderer';
export { AreaRenderer } from './rendering/AreaRenderer';
export { OHLCBarRenderer } from './rendering/OHLCBarRenderer';

// Drawing tools (MVP: trend line + horizontal line + DrawingLayer)
export { Drawing } from './drawings/Drawing';
export type { AnchorPoint, DrawingSnapshot } from './drawings/Drawing';
export { TrendLine } from './drawings/TrendLine';
export { HorizontalLine } from './drawings/HorizontalLine';
export { DrawingLayer } from './drawings/DrawingLayer';

// Data transforms (Heikin Ashi, Renko)
export { toHeikinAshi, advanceHeikinAshi } from './transforms/heikinAshi';
export { toRenko } from './transforms/renko';

// Interaction
export { Viewport } from './interaction/Viewport';
export { PanZoomController } from './interaction/PanZoomController';
export { CrosshairController } from './interaction/CrosshairController';
export { KeyboardController } from './interaction/KeyboardController';
export type { KeyboardCallbacks } from './interaction/KeyboardController';

// Constants & Utilities
export { DARK_THEME, LIGHT_THEME } from './constants';
export { resolveTheme, formatPrice, formatVolume, formatTime, computeLayout } from './utils';
