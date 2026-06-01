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
  CrosshairMode,
  HoverInfo,
  HoveredObject,
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

// Vector SVG export (C7). Kept in a standalone module that ChartEngine /
// OHLCVChart never import, so it tree-shakes to zero in the base chart — a
// host pays for it only by importing `chartEngineToSVG` / `SVGRenderingContext`
// (or the `*` barrel). See export/toSVG.ts for the design rationale.
export { chartEngineToSVG } from './export/toSVG';
export { SVGRenderingContext } from './export/svgContext';
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

// Primary-series renderers (also reused by the built-in series definitions).
export { LineRenderer } from './rendering/LineRenderer';
export { AreaRenderer, withAlpha } from './rendering/AreaRenderer';
export { BaselineRenderer } from './rendering/BaselineRenderer';
export type { BaselineRenderOptions } from './rendering/BaselineRenderer';
export { OHLCBarRenderer } from './rendering/OHLCBarRenderer';
export { HeikinAshiRenderer, buildHeikinAshiView, HEIKIN_ASHI_WARMUP } from './rendering/HeikinAshiRenderer';

// Custom Series API (registry-dispatched primary series)
export type { SeriesDefinition, SeriesRenderContext, SeriesPriceRange } from './series/Series';
export { registerSeriesType, getSeriesType, listSeriesTypes } from './series/registry';
export {
  candleSeries,
  lineSeries,
  areaSeries,
  ohlcSeries,
  heikinAshiSeries,
  baselineSeries,
  createBaselineSeries,
} from './series/builtins';

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
export { ParallelChannel } from './drawings/ParallelChannel';
export { RegressionChannel } from './drawings/RegressionChannel';
export type { CloseSampler } from './drawings/RegressionChannel';
export { Pitchfork } from './drawings/Pitchfork';
export { FibFan } from './drawings/FibFan';
export { Measure } from './drawings/Measure';
export { DrawingLayer } from './drawings/DrawingLayer';

// Markers (candle-anchored point annotations)
export { markerY } from './markers/Marker';
export type { Marker, MarkerPosition, MarkerShape } from './markers/Marker';
export { MarkerRenderer } from './markers/MarkerRenderer';

// Price alerts (C3)
export { AlertManager } from './alerts/AlertManager';
export type { Alert, AlertCondition, AlertInit } from './alerts/Alert';

// Primitives (programmatic z-ordered overlays)
export { clipToChart, clipToPane, paneBounds } from './primitives/Primitive';
export type { Primitive, PrimitiveZOrder } from './primitives/Primitive';
export { WatermarkPrimitive } from './primitives/WatermarkPrimitive';
export type { WatermarkOptions, WatermarkPosition } from './primitives/WatermarkPrimitive';
export { PriceLinePrimitive } from './primitives/PriceLinePrimitive';
export type { PriceLineOptions, PriceLineHandle } from './primitives/PriceLinePrimitive';

// Compare mode (C2) — overlay normalized foreign symbols. Optional and
// standalone: `OHLCVChart` / `ChartEngine` never import this module, so it
// tree-shakes to zero in the base bundle. A host opts in by constructing
// `CompareController` explicitly (see compare/CompareController.ts).
export { CompareController } from './compare/CompareController';
export type { CompareHost } from './compare/CompareController';
export { ComparePrimitive, CompareScale, normalize as normalizeCompareValue } from './compare/ComparePrimitive';
export type { CompareSeries, CompareNormalization } from './compare/CompareSeries';

// Volume Profile (C4) — horizontal volume-by-price histogram of the visible
// window. Optional and standalone: `OHLCVChart` / `ChartEngine` never import
// this module, so it tree-shakes to zero in the base bundle. A host opts in by
// constructing `VolumeProfileController` explicitly (see
// profile/VolumeProfileController.ts).
export { computeVolumeProfile } from './profile/computeVolumeProfile';
export type { VolumeBin, VolumeProfile } from './profile/computeVolumeProfile';
export { VolumeProfilePrimitive } from './profile/VolumeProfilePrimitive';
export type {
  VolumeProfileOptions,
  VolumeProfileColors,
  VolumeProfileSide,
} from './profile/VolumeProfilePrimitive';
export { VolumeProfileController } from './profile/VolumeProfileController';
export type { VolumeProfileHost } from './profile/VolumeProfileController';

// WebGL candle backend (D2, stretch) — OPTIONAL GPU-instanced renderer for the
// candle hot path only (axes/legend/crosshair stay Canvas2D). Standalone:
// `OHLCVChart` / `ChartEngine` never import this module, so it tree-shakes to
// zero in the base bundle. A host opts in by constructing
// `WebGLCandleRenderer` over its own canvas (see webgl/WebGLCandleRenderer.ts).
// The geometry step `buildCandleVertices` is a pure, GL-free function reusable
// for custom GPU pipelines.
export { WebGLCandleRenderer } from './webgl/WebGLCandleRenderer';
export { buildCandleVertices } from './webgl/candleGeometry';
export type { CandleVertexData } from './webgl/candleGeometry';

// Data transforms (Heikin Ashi, Renko)
export { toHeikinAshi, advanceHeikinAshi } from './transforms/heikinAshi';
export { toRenko } from './transforms/renko';

// Horizontal-scale behaviors (X-axis domain abstraction)
export type { HorzScaleBehavior } from './horzscale/HorzScaleBehavior';
export { TimeScaleBehavior } from './horzscale/TimeScaleBehavior';
export { PriceScaleBehavior } from './horzscale/PriceScaleBehavior';
export { YieldCurveBehavior } from './horzscale/YieldCurveBehavior';
export {
  registerHorzScaleBehavior,
  createHorzScaleBehavior,
  listHorzScaleBehaviors,
} from './horzscale/registry';

// Interaction
export { Viewport } from './interaction/Viewport';
export type { GridTick, PriceScaleSide } from './interaction/Viewport';
export { priceToTransformed, transformedToPrice, LOG_MIN_POSITIVE } from './interaction/priceScale';
export type { PriceScaleMode } from './interaction/priceScale';
export { PanZoomController } from './interaction/PanZoomController';
export { CrosshairController } from './interaction/CrosshairController';
export { KeyboardController } from './interaction/KeyboardController';
export type { KeyboardCallbacks } from './interaction/KeyboardController';
export { ReplayController, DEFAULT_BARS_PER_SECOND } from './interaction/ReplayController';
export type { ReplayOptions } from './interaction/ReplayController';

// i18n (C6 — locale-aware formatting + translatable strings)
export { createI18n, DEFAULT_MESSAGES } from './i18n/messages';
export type { Messages, I18n } from './i18n/messages';
export {
  createPriceFormatter,
  createVolumeFormatter,
  createDateFormatter,
  formatPercentLocale,
  resolutionToDateResolution,
} from './i18n/format';
export type { NumberFormatFn, DateFormatFn, DateResolution } from './i18n/format';

// Constants & Utilities
export { DARK_THEME, LIGHT_THEME } from './constants';
export { resolveTheme, formatPrice, formatVolume, formatPercent, formatTime, computeLayout } from './utils';
