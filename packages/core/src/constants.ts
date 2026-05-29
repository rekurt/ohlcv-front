import type { ThemeColors } from './types';

// Layout
export const PRICE_AXIS_WIDTH = 80;
export const TIME_AXIS_HEIGHT = 30;
export const VOLUME_HEIGHT_RATIO = 0.2;
export const PRICE_PADDING_RATIO = 0.05;
/** Height (px) reserved for each sub-pane indicator band. */
export const INDICATOR_PANE_HEIGHT = 80;
/** Minimum height (px) the main candle area must retain. */
export const MIN_MAIN_AREA_HEIGHT = 120;

// Candle sizing
export const DEFAULT_CANDLE_WIDTH = 8;
export const MIN_CANDLE_WIDTH = 2;
export const MAX_CANDLE_WIDTH = 30;
/**
 * Floor used by `fitAll` only, so "fit everything" can go sub-pixel and
 * truly show a multi-million-bar history at once (interactive `zoom` still
 * clamps to MIN_CANDLE_WIDTH). At this width the conflation path collapses
 * the sub-pixel candles to one bar per column.
 */
export const MIN_CANDLE_WIDTH_FIT = 1e-4;
export const CANDLE_GAP_RATIO = 0.3; // gap between candles as ratio of width
export const WICK_WIDTH = 1;
export const MIN_CANDLE_BODY_HEIGHT = 1;

// Buffer
export const INITIAL_CAPACITY = 2048;
export const GROWTH_FACTOR = 2;

// Interaction
export const MOMENTUM_FRICTION = 0.95;
export const MOMENTUM_THRESHOLD = 0.5;

/**
 * Visible-window size (in candles) above which `autoScale` uses the coarse
 * range index instead of a linear scan. Below it the linear scan is cheaper
 * than the index's per-query overhead.
 */
export const RANGE_ACCEL_THRESHOLD = 5000;

// Fonts (single source of truth for canvas text)
export const AXIS_FONT = '11px monospace';
export const LEGEND_FONT = '12px monospace';
export const PILL_FONT_SIZE = 12;
export const PILL_FONT = `${PILL_FONT_SIZE}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;

// Axis labels & padding
export const AXIS_LABEL_HEIGHT = 20;
export const AXIS_LABEL_TEXT_PAD = 8;  // horizontal text offset inside price-axis labels
export const AXIS_LABEL_BG_INSET = 2;  // gap between axis line and label background rect
export const TIME_AXIS_LABEL_GAP = 8;  // vertical gap below chart area for time axis text

// Crosshair
export const CROSSHAIR_DASH: readonly [number, number] = [4, 4];
export const CROSSHAIR_TIME_LABEL_PAD_X = 12;  // horizontal padding around time label under crosshair

// GoToLive pill
export const PILL_PADDING_X = 12;
export const PILL_PADDING_Y = 6;
export const PILL_MARGIN = 12;

// Legend
export const LEGEND_MARGIN_LEFT = 10;
export const LEGEND_MARGIN_TOP = 16;

// Drawings
/** Pixel radius within which a click is considered a hit on a drawing. */
export const DRAWING_HIT_TOLERANCE_PX = 6;
/** Side length (px) of the square handles drawn on a selected drawing. */
export const DRAWING_HANDLE_PX = 7;

// Markers
/** Default marker glyph size (px). */
export const MARKER_SIZE = 9;
/** Gap (px) between a candle's high/low and an above/below marker. */
export const MARKER_GAP = 6;
/** Font for marker text labels. */
export const MARKER_FONT = '10px system-ui, sans-serif';

// Themes
export const DARK_THEME: ThemeColors = {
  background: '#131722',
  bullCandle: '#26a69a',
  bearCandle: '#ef5350',
  bullVolume: 'rgba(38,166,154,0.3)',
  bearVolume: 'rgba(239,83,80,0.3)',
  grid: '#1e222d',
  axis: '#363a45',
  text: '#d1d4dc',
  crosshair: '#758696',
  priceLine: '#4c525e',
};

export const LIGHT_THEME: ThemeColors = {
  background: '#ffffff',
  bullCandle: '#26a69a',
  bearCandle: '#ef5350',
  bullVolume: 'rgba(38,166,154,0.3)',
  bearVolume: 'rgba(239,83,80,0.3)',
  grid: '#f0f3fa',
  axis: '#c8ccd8',
  text: '#131722',
  crosshair: '#9598a1',
  priceLine: '#b2b5be',
};
