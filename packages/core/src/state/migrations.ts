import { ValidationError } from '../data/validation';
import type { ChartState } from './ChartState';

/**
 * The current schema version. Bump this whenever the shape of
 * `LayoutState` / `FullState` changes in a way old snapshots cannot
 * be deserialized against the new code. Then add a migration from
 * the previous version to the new one in `migrations` below.
 */
export const CURRENT_STATE_VERSION = 1;

/**
 * A migration steps a snapshot exactly one version forward.
 * Signature is `(prev) => next` — no async, no side effects, no IO.
 * The returned object MUST satisfy the next version's shape.
 *
 * Migrations are pure so they can be safely re-run in test fixtures
 * and snapshot harnesses; do not log or warn here either.
 */
export type StateMigration = (prev: Record<string, unknown>) => Record<string, unknown>;

/**
 * Registry of migrations indexed by the FROM-version. To migrate a
 * `version: 1` snapshot up to v3, we apply `migrations[1]` then
 * `migrations[2]` in order. There is intentionally no v0 entry —
 * pre-1.0 prereleases are unsupported and the user must re-create
 * their layout from scratch.
 *
 * Today there are no historical versions (v1 is the only release).
 * Once v2 ships, add an entry like:
 *
 *   migrations[1] = (s) => ({ ...s, version: 2, // ...new fields });
 */
export const migrations: Record<number, StateMigration> = {};

/**
 * Bring an unknown snapshot up to the current schema version by
 * applying migrations in order. Returns a typed `ChartState`.
 *
 * Throws `ValidationError` if:
 *  - the snapshot is missing/has a non-numeric `version`,
 *  - the version is newer than this build can handle, or
 *  - a required migration step is missing.
 */
export function migrateState(raw: unknown): ChartState {
  if (typeof raw !== 'object' || raw === null) {
    throw new ValidationError('migrateState', raw, 'state must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const v = obj['version'];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new ValidationError(
      'migrateState',
      raw,
      `state.version must be a positive integer, got ${String(v)}`,
    );
  }
  if (v > CURRENT_STATE_VERSION) {
    throw new ValidationError(
      'migrateState',
      raw,
      `state.version ${v} is newer than this build (current is ${CURRENT_STATE_VERSION}). Upgrade the library.`,
    );
  }

  let current: Record<string, unknown> = obj;
  for (let from = v; from < CURRENT_STATE_VERSION; from++) {
    const step = migrations[from];
    if (!step) {
      throw new ValidationError(
        'migrateState',
        raw,
        `no migration registered from v${from} to v${from + 1}`,
      );
    }
    current = step(current);
  }
  return current as unknown as ChartState;
}
