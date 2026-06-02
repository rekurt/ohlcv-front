/**
 * Price-alert domain types (C3).
 *
 * An alert watches the chart's close price and fires once when the price
 * relationship the user configured becomes true. lightweight-charts has no
 * built-in alert system; this is a core feature of `@rekurt/ohlcv-core`.
 */

/**
 * How an alert decides it has triggered, compared against the price step
 * `(prevClose → newClose)` of a realtime tick:
 *
 * - `crossing` — the price moved across the level in EITHER direction
 *   (i.e. `prev` and `new` sit on opposite sides of `price`, or `new`
 *   lands exactly on it). The "alert when price touches this level" mode.
 * - `above` — fires only on an upward break: `prev < price && new >= price`.
 * - `below` — fires only on a downward break: `prev > price && new <= price`.
 */
export type AlertCondition = 'crossing' | 'above' | 'below';

/**
 * A configured price alert. `active` is the one-shot gate: a fired alert is
 * flipped to `false` so it never re-triggers on subsequent ticks until the
 * host explicitly re-arms it (`AlertManager.setActive(id, true)`).
 */
export interface Alert {
  /** Stable id assigned on creation (`a_<n>`), or the host-supplied one. */
  id: string;
  /** Price level the alert watches. */
  price: number;
  /** Trigger semantics — see {@link AlertCondition}. */
  condition: AlertCondition;
  /** Optional human-readable note delivered to the `onAlert` callback. */
  message?: string;
  /** False once the alert has fired (one-shot) or was disabled by the host. */
  active: boolean;
}

/**
 * Input accepted by `AlertManager.add` / `OHLCVChart.addAlert`. Only `price`
 * is required; `condition` defaults to `'crossing'`, the alert starts active,
 * and an id is generated when one is not supplied.
 */
export interface AlertInit {
  /** Price level the alert watches. */
  price: number;
  /** Trigger semantics. Default: `'crossing'`. */
  condition?: AlertCondition;
  /** Optional human-readable note. */
  message?: string;
  /** Supply a stable id (e.g. when restoring persisted state); else generated. */
  id?: string;
}
