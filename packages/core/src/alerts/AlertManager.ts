import type { Alert, AlertCondition, AlertInit } from './Alert';

/**
 * In-memory collection of price alerts with one-shot trigger evaluation (C3).
 *
 * The manager is data-only: it owns no DOM and no rendering. `OHLCVChart`
 * drives it from the realtime path — feeding each close-price step through
 * {@link check} — and mirrors the active alerts to on-chart price lines.
 *
 * Ids are generated from a monotonically increasing counter (`a_0`, `a_1`,
 * …), matching the stable-counter scheme used elsewhere in the core
 * (e.g. `priceline:<n>`) rather than `Math.random`. This keeps ids
 * deterministic across a session so tests and host code can rely on them.
 */
export class AlertManager {
  private readonly _alerts: Alert[] = [];
  private _seq = 0;

  /**
   * Create and store an alert. Generates a stable `a_<n>` id when `init.id`
   * is omitted. A supplied id wins as-is (used when restoring persisted
   * state) — the counter is advanced past any numeric `a_<n>` collision so a
   * later auto-generated id can't duplicate a restored one.
   */
  add(init: AlertInit): Alert {
    const condition: AlertCondition = init.condition ?? 'crossing';
    const alert: Alert = {
      id: init.id ?? this._nextId(),
      price: init.price,
      condition,
      active: true,
    };
    // Only attach `message` when provided so the object shape stays clean
    // (no explicit `message: undefined`) for serialization round-trips.
    if (init.message !== undefined) alert.message = init.message;
    if (init.id !== undefined) this._bumpSeqPast(init.id);
    this._alerts.push(alert);
    return alert;
  }

  /** Remove an alert by id. Returns true if one was removed. */
  remove(id: string): boolean {
    const idx = this._alerts.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    this._alerts.splice(idx, 1);
    return true;
  }

  /** Look up an alert by id, or undefined. */
  get(id: string): Alert | undefined {
    return this._alerts.find((a) => a.id === id);
  }

  /** All alerts in insertion order (live references, not copies). */
  list(): Alert[] {
    return this._alerts.slice();
  }

  /** Remove every alert. */
  clear(): void {
    this._alerts.length = 0;
  }

  /**
   * Re-arm (or disable) an alert by id. Re-arming a fired one-shot alert is
   * how a host makes it triggerable again. Returns true if the alert exists.
   */
  setActive(id: string, active: boolean): boolean {
    const alert = this.get(id);
    if (!alert) return false;
    alert.active = active;
    return true;
  }

  /**
   * Evaluate every ACTIVE alert against a single close-price step
   * (`prevPrice → newPrice`) and return the ones that fired. Each fired
   * alert is flipped to `active = false` (one-shot) so it won't re-trigger
   * on later ticks until re-armed.
   *
   * The input prices are never mutated. Triggering rules per condition:
   * - `crossing`: `prev` and `new` straddle `price` (the products of the two
   *   signed distances is negative), or `new === price` exactly.
   * - `above`: `prev < price && new >= price`.
   * - `below`: `prev > price && new <= price`.
   *
   * `NaN` inputs never trigger (all comparisons are false), so a malformed
   * tick is safely ignored rather than firing spuriously.
   */
  check(prevPrice: number, newPrice: number): Alert[] {
    const fired: Alert[] = [];
    for (const alert of this._alerts) {
      if (!alert.active) continue;
      if (AlertManager.triggers(alert.condition, alert.price, prevPrice, newPrice)) {
        alert.active = false;
        fired.push(alert);
      }
    }
    return fired;
  }

  /**
   * Pure predicate: does a `prev → next` price step satisfy `condition`
   * relative to `level`? Exposed as a static so tests and hosts can probe
   * the trigger logic without constructing a manager.
   */
  static triggers(
    condition: AlertCondition,
    level: number,
    prev: number,
    next: number,
  ): boolean {
    // A non-finite step (NaN/Infinity from a malformed tick) carries no
    // usable crossing information — never fire on it. In normal operation
    // both prices come from the buffer's finite-validated close, so this
    // guard only ever rejects pathological inputs.
    if (!Number.isFinite(prev) || !Number.isFinite(next)) return false;
    switch (condition) {
      case 'above':
        return prev < level && next >= level;
      case 'below':
        return prev > level && next <= level;
      case 'crossing': {
        // Exact landing on the level always counts (covers `prev === level`
        // staying put, and a move that lands precisely on it).
        if (next === level) return true;
        const dPrev = prev - level;
        const dNext = next - level;
        // Opposite signs ⇒ the path crossed the level. `dPrev === 0` (started
        // on the level then moved off) is handled by the strict `< 0` below
        // being false, which is intentional: a move OFF the level is not a new
        // crossing — only a move ONTO or THROUGH it is.
        return dPrev * dNext < 0;
      }
    }
  }

  private _nextId(): string {
    return `a_${this._seq++}`;
  }

  /**
   * If `id` is a generated-style `a_<n>`, advance the counter past `n` so a
   * future `_nextId()` won't collide with this restored id.
   */
  private _bumpSeqPast(id: string): void {
    const m = /^a_(\d+)$/.exec(id);
    if (!m) return;
    const n = Number(m[1]);
    if (Number.isInteger(n) && n >= this._seq) this._seq = n + 1;
  }
}
