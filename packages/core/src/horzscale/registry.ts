import type { HorzScaleBehavior } from './HorzScaleBehavior';
import { TimeScaleBehavior } from './TimeScaleBehavior';
import { PriceScaleBehavior } from './PriceScaleBehavior';
import { YieldCurveBehavior } from './YieldCurveBehavior';

type HorzScaleFactory = () => HorzScaleBehavior;

const REGISTRY = new Map<string, HorzScaleFactory>();
REGISTRY.set('time', () => new TimeScaleBehavior());
REGISTRY.set('price', () => new PriceScaleBehavior());
REGISTRY.set('yield-curve', () => new YieldCurveBehavior());

/**
 * Register a named horizontal-scale behavior factory (e.g. 'yield-curve').
 * Overwrites any existing factory with the same name.
 */
export function registerHorzScaleBehavior(name: string, factory: HorzScaleFactory): void {
  REGISTRY.set(name, factory);
}

/** Construct a registered behavior by name, or undefined if unregistered. */
export function createHorzScaleBehavior(name: string): HorzScaleBehavior | undefined {
  return REGISTRY.get(name)?.();
}

/** All registered behavior names. */
export function listHorzScaleBehaviors(): string[] {
  return [...REGISTRY.keys()];
}
