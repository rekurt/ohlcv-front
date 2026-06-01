import type { SeriesDefinition } from './Series';
import { BUILTIN_SERIES, candleSeries } from './builtins';

const REGISTRY = new Map<string, SeriesDefinition>();
for (const def of BUILTIN_SERIES) REGISTRY.set(def.type, def);

/**
 * Register a custom primary-series type. Overwrites any existing definition
 * with the same `type`. Register before `loadState` if a saved chart uses a
 * custom type, or the load falls back to candles.
 */
export function registerSeriesType(def: SeriesDefinition): void {
  REGISTRY.set(def.type, def);
}

/** Look up a series definition by type, or undefined if unregistered. */
export function getSeriesType(type: string): SeriesDefinition | undefined {
  return REGISTRY.get(type);
}

/** All registered series types, in no particular order. */
export function listSeriesTypes(): string[] {
  return [...REGISTRY.keys()];
}

/** The default series used when a requested type is unregistered. */
export const DEFAULT_SERIES = candleSeries;
