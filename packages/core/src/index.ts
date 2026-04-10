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
} from './types';

// Data layer
export { CandleBuffer } from './data/CandleBuffer';
export { CandleMerger } from './data/CandleMerger';
export { DataFeed } from './data/DataFeed';
export { PollingTransport } from './data/PollingTransport';
export type { PollingTransportConfig } from './data/PollingTransport';
export { WebSocketTransport } from './data/WebSocketTransport';

// Rendering
export { ChartEngine } from './rendering/ChartEngine';
export { GoToLiveRenderer } from './rendering/GoToLiveRenderer';
export type { GoToLiveBounds } from './rendering/GoToLiveRenderer';

// Interaction
export { Viewport } from './interaction/Viewport';
export { PanZoomController } from './interaction/PanZoomController';
export { CrosshairController } from './interaction/CrosshairController';
export { KeyboardController } from './interaction/KeyboardController';
export type { KeyboardCallbacks } from './interaction/KeyboardController';

// Constants & Utilities
export { DARK_THEME, LIGHT_THEME } from './constants';
export { resolveTheme, formatPrice, formatVolume, formatTime, computeLayout } from './utils';
