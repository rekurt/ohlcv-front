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

// Interaction
export { Viewport } from './interaction/Viewport';
export { PanZoomController } from './interaction/PanZoomController';
export { CrosshairController } from './interaction/CrosshairController';

// Constants & Utilities
export { DARK_THEME, LIGHT_THEME } from './constants';
export { resolveTheme, formatPrice, formatVolume, formatTime, computeLayout } from './utils';
