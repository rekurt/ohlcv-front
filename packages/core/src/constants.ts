import type { ThemeColors } from './types';

// Layout
export const PRICE_AXIS_WIDTH = 80;
export const TIME_AXIS_HEIGHT = 30;
export const VOLUME_HEIGHT_RATIO = 0.2;
export const PRICE_PADDING_RATIO = 0.05;

// Candle sizing
export const DEFAULT_CANDLE_WIDTH = 8;
export const MIN_CANDLE_WIDTH = 2;
export const MAX_CANDLE_WIDTH = 30;
export const CANDLE_GAP_RATIO = 0.3; // gap between candles as ratio of width
export const WICK_WIDTH = 1;
export const MIN_CANDLE_BODY_HEIGHT = 1;

// Buffer
export const INITIAL_CAPACITY = 2048;
export const GROWTH_FACTOR = 2;

// Interaction
export const MOMENTUM_FRICTION = 0.95;
export const MOMENTUM_THRESHOLD = 0.5;

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
