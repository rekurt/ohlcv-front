import type { Candle, ChartType, ThemeMode, ThemeColors } from '../types';
import type { PriceScaleMode } from '../interaction/priceScale';
import type { IndicatorConfig } from '../indicators/registry';
import type { DrawingSnapshot } from '../drawings/Drawing';

/**
 * Serialized chart state without the data window. This is the "share via
 * URL" flavor — small enough to fit in a query param after base64 encoding,
 * typically a few hundred bytes.
 *
 * Restoring a LayoutState over a chart that already has data is fine:
 * `loadState` will skip `setData` when no `data` field is present and
 * restore only the visual/interaction layer (viewport, chartType, theme,
 * indicators, drawings).
 *
 * `version: 1` is the schema version. Bump it on breaking changes and
 * migrate old states inside `loadState`.
 */
export interface LayoutState {
  version: 1;
  symbol: string;
  resolution: string;
  chartType: ChartType;
  theme: ThemeMode | ThemeColors;
  viewport: {
    startIndex: number;
    candleWidth: number;
    autoFollow: boolean;
    /**
     * Price-axis scale mode. Optional + additive: states written before
     * F1 omit it and load back as `'linear'`, so no schema bump needed.
     */
    priceScaleMode?: PriceScaleMode;
  };
  indicators: IndicatorConfig[];
  drawings: DrawingSnapshot[];
}

/**
 * Full chart snapshot — includes the candle data window. Use for workspace
 * persistence, bug reproduction, or any case where the receiver should not
 * re-fetch data through a transport. Typically 100 KB – 1 MB depending on
 * buffer length.
 */
export interface FullState extends LayoutState {
  data: Candle[];
}

export type ChartState = LayoutState | FullState;

/** Discriminator for `loadState` — does the snapshot include data? */
export function isFullState(state: ChartState): state is FullState {
  return Array.isArray((state as FullState).data);
}
