export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t: number; // unix seconds
}

export interface CandleView {
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  time: Float64Array;
  length: number;
  offset: number; // index offset in the full buffer
}

export interface DataFeedConfig {
  symbol: string;
  resolution: string;
}

export interface HistoryRequest {
  symbol: string;
  resolution: string;
  from: number;
  to: number; // unix seconds
}

export interface DataTransport {
  fetchHistory(req: HistoryRequest): Promise<Candle[]>;
  subscribe(config: DataFeedConfig, onUpdate: (candles: Candle[]) => void): void;
  unsubscribe(): void;
  destroy(): void;
}

export interface ThemeColors {
  background: string;
  bullCandle: string;
  bearCandle: string;
  bullVolume: string;
  bearVolume: string;
  grid: string;
  axis: string;
  text: string;
  crosshair: string;
  priceLine: string;
}

export type ThemeMode = 'dark' | 'light';

export interface ChartConfig {
  container: HTMLElement;
  symbol: string;
  resolution: string;
  transport?: DataTransport;
  theme?: ThemeMode | ThemeColors;
  locale?: string;
  priceFormat?: (price: number) => string;
  volumeFormat?: (volume: number) => string;
  onCandleClick?: (candle: Candle, index: number) => void;
  onVisibleRangeChange?: (from: number, to: number) => void;
}

export interface ChartLayout {
  width: number;
  height: number;
  chartTop: number;
  chartBottom: number;
  chartLeft: number;
  chartRight: number;
  volumeTop: number;
  volumeBottom: number;
  priceAxisWidth: number;
  timeAxisHeight: number;
}
