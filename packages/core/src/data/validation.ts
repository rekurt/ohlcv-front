import type { Candle } from '../types';

/**
 * Thrown when raw data from a transport does not conform to the Candle
 * contract. Includes structured `where` (a caller-provided label) and the
 * actual received value so downstream consumers can log or dispatch it.
 */
export class ValidationError extends Error {
  constructor(
    public readonly where: string,
    public readonly received: unknown,
    message: string,
  ) {
    super(`[ohlcv] validation failed at ${where}: ${message}`);
    this.name = 'ValidationError';
    // Preserve prototype for `instanceof` across the ES5 downlevel boundary.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Validate an unknown value as a Candle. Returns a new object containing
 * exactly the Candle fields (extra fields are stripped). Throws
 * ValidationError on any violation.
 *
 * @param value unknown value to validate
 * @param where caller-provided label used in error messages
 */
export function validateCandle(value: unknown, where: string): Candle {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(where, value, 'expected a candle object');
  }
  const v = value as Record<string, unknown>;
  const fields: (keyof Candle)[] = ['o', 'h', 'l', 'c', 'v', 't'];
  for (const field of fields) {
    if (!isFiniteNumber(v[field])) {
      throw new ValidationError(where, value, `field "${field}" must be a finite number`);
    }
  }
  const o = v['o'] as number;
  const h = v['h'] as number;
  const l = v['l'] as number;
  const c = v['c'] as number;
  const vol = v['v'] as number;
  const t = v['t'] as number;

  if (t <= 0) {
    throw new ValidationError(where, value, `field "t" must be positive unix seconds, got ${t}`);
  }
  if (h < l) {
    throw new ValidationError(where, value, `high (${h}) is less than low (${l})`);
  }
  if (h < Math.max(o, c)) {
    throw new ValidationError(
      where,
      value,
      `high (${h}) must be >= max(open, close) (${Math.max(o, c)})`,
    );
  }
  if (l > Math.min(o, c)) {
    throw new ValidationError(
      where,
      value,
      `low (${l}) must be <= min(open, close) (${Math.min(o, c)})`,
    );
  }
  if (vol < 0) {
    throw new ValidationError(where, value, `volume "v" must be >= 0, got ${vol}`);
  }

  // Strip extras — return a fresh Candle object.
  return { o, h, l, c, v: vol, t };
}

/**
 * Validate an unknown value as an array of candles. Each element is
 * validated individually; on first failure the ValidationError mentions the
 * offending index so callers can pinpoint the bad row. Extras are stripped.
 */
export function validateCandles(value: unknown, where: string): Candle[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(where, value, 'expected an array of candles');
  }
  const out: Candle[] = new Array(value.length);
  for (let i = 0; i < value.length; i++) {
    try {
      out[i] = validateCandle(value[i], where);
    } catch (cause) {
      if (cause instanceof ValidationError) {
        throw new ValidationError(where, value[i], `[${i}] ${cause.message}`);
      }
      throw cause;
    }
  }
  return out;
}
