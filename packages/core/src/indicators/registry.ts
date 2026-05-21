import type { Indicator } from './Indicator';
import { SMA } from './SMA';
import { EMA } from './EMA';
import { BollingerBands } from './BollingerBands';
import { RSI } from './RSI';
import { MACD } from './MACD';
import { Stochastic } from './Stochastic';
import { ATR } from './ATR';
import { VWAP, type VWAPAnchor } from './VWAP';
import { WilliamsR } from './WilliamsR';
import { OBV } from './OBV';
import { ADX } from './ADX';
import { CCI } from './CCI';

/**
 * Discriminated union of all built-in indicator configurations. Users of
 * the React/Vue wrappers construct these plain objects instead of calling
 * `new SMA(20)` directly — the wrapper then runs them through
 * `createIndicator` during reconciliation.
 *
 * Adding a new indicator:
 *   1. Add its type to the union below
 *   2. Add a case in `createIndicator`
 *   3. Add a case in `indicatorId`
 *
 * The switch statements in both functions are marked `never`-exhaustive,
 * so forgetting one will fail typecheck.
 */
export type IndicatorConfig =
  | { type: 'sma'; period: number }
  | { type: 'ema'; period: number }
  | { type: 'bb'; period: number; stdDev: number }
  | { type: 'rsi'; period: number }
  | { type: 'macd'; fast: number; slow: number; signal: number }
  | { type: 'stoch'; kPeriod: number; dPeriod: number }
  | { type: 'atr'; period: number }
  | { type: 'vwap'; anchor: VWAPAnchor }
  | { type: 'williamsr'; period: number }
  | { type: 'obv' }
  | { type: 'adx'; period: number }
  | { type: 'cci'; period: number };

/**
 * Stable string id derived from an indicator config. Two configs with the
 * same shape produce the same id; different shapes produce different ids.
 * Used as the diff key in `diffIndicatorConfigs`.
 */
export function indicatorId(cfg: IndicatorConfig): string {
  switch (cfg.type) {
    case 'sma':
      return `sma:${cfg.period}`;
    case 'ema':
      return `ema:${cfg.period}`;
    case 'bb':
      return `bb:${cfg.period}:${cfg.stdDev}`;
    case 'rsi':
      return `rsi:${cfg.period}`;
    case 'macd':
      return `macd:${cfg.fast}:${cfg.slow}:${cfg.signal}`;
    case 'stoch':
      return `stoch:${cfg.kPeriod}:${cfg.dPeriod}`;
    case 'atr':
      return `atr:${cfg.period}`;
    case 'vwap':
      // Anchor may be a string literal ('session'/'cumulative') or
      // an object `{ type: 'anchored', t }`. Encode both so the diff
      // key still distinguishes them.
      return typeof cfg.anchor === 'string'
        ? `vwap:${cfg.anchor}`
        : `vwap:anchored:${cfg.anchor.t}`;
    case 'williamsr':
      return `williamsr:${cfg.period}`;
    case 'obv':
      return 'obv';
    case 'adx':
      return `adx:${cfg.period}`;
    case 'cci':
      return `cci:${cfg.period}`;
  }
}

/**
 * Factory that instantiates a concrete Indicator from a config. This is
 * the only path by which wrapper-driven code creates indicators — user
 * components never import `SMA`, `EMA`, etc. directly in React/Vue apps.
 *
 * Throws with a descriptive message if given an unknown type at runtime
 * (most likely from a `loadState(json)` call with a newer schema).
 */
export function createIndicator(cfg: IndicatorConfig): Indicator {
  switch (cfg.type) {
    case 'sma':
      return new SMA(cfg.period);
    case 'ema':
      return new EMA(cfg.period);
    case 'bb':
      return new BollingerBands(cfg.period, cfg.stdDev);
    case 'rsi':
      return new RSI(cfg.period);
    case 'macd':
      return new MACD(cfg.fast, cfg.slow, cfg.signal);
    case 'stoch':
      return new Stochastic(cfg.kPeriod, cfg.dPeriod);
    case 'atr':
      return new ATR(cfg.period);
    case 'vwap':
      return new VWAP(cfg.anchor);
    case 'williamsr':
      return new WilliamsR(cfg.period);
    case 'obv':
      return new OBV();
    case 'adx':
      return new ADX(cfg.period);
    case 'cci':
      return new CCI(cfg.period);
    default: {
      // Exhaustiveness guard for the union above — TypeScript flags any
      // missing case at compile time. The runtime throw covers forged
      // JSON states loaded from a newer schema.
      const _exhaustive: never = cfg;
      throw new Error(
        `[ohlcv] Unknown indicator type in config: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

export interface IndicatorDiff {
  /** True if `added.length > 0 || removed.length > 0`. */
  changed: boolean;
  /** Ids present in `next` but missing in `prev`. */
  added: string[];
  /** Ids present in `prev` but missing in `next`. */
  removed: string[];
  /** Ids present in both `prev` and `next`. */
  kept: string[];
}

/**
 * Pure-function diff of two `IndicatorConfig[]` arrays by `indicatorId`.
 * Called by both React (useEffect) and Vue (watch) wrappers to decide
 * whether to call `chart.setIndicators(next.map(createIndicator))`.
 *
 * Handles duplicates in the input by deduping via the id set — two
 * identical configs collapse to one kept id.
 */
export function diffIndicatorConfigs(
  prev: IndicatorConfig[],
  next: IndicatorConfig[],
): IndicatorDiff {
  const prevIds = new Set(prev.map(indicatorId));
  const nextIds = new Set(next.map(indicatorId));

  const added: string[] = [];
  const removed: string[] = [];
  const kept: string[] = [];

  for (const id of nextIds) {
    if (prevIds.has(id)) kept.push(id);
    else added.push(id);
  }
  for (const id of prevIds) {
    if (!nextIds.has(id)) removed.push(id);
  }

  return {
    changed: added.length > 0 || removed.length > 0,
    added,
    removed,
    kept,
  };
}
