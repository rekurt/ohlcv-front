import type { CandleBuffer } from './CandleBuffer';

/**
 * A run of missing candles between two consecutive candles in the buffer —
 * i.e. their timestamps are further apart than one resolution interval.
 *
 * Gaps are normal for non-24/7 markets (weekends, exchange close) and a
 * signal of dropped data for 24/7 markets (crypto). `findGaps` only
 * *detects* them; the consumer decides whether to backfill, draw a session
 * break, or ignore.
 */
export interface CandleGap {
  /** Index of the candle just before the gap. */
  fromIndex: number;
  /** Index of the candle just after the gap. */
  toIndex: number;
  /** Timestamp (Unix seconds) of `fromIndex`. */
  fromTime: number;
  /** Timestamp (Unix seconds) of `toIndex`. */
  toTime: number;
  /** Estimated number of missing candles in the gap. */
  missingCount: number;
}

/**
 * Map a resolution string to its interval in seconds. Returns `null` for
 * calendar-variable resolutions (`'1M'` months) where a fixed second-count
 * would produce false gaps, and for unrecognized strings.
 *
 * Accepts both lower- and upper-case unit suffixes used across the library
 * (`'1H'`/`'1h'`, `'1D'`/`'1d'`, `'1W'`/`'1w'`).
 */
export function resolutionToSeconds(resolution: string): number | null {
  const m = /^(\d+)\s*([mhHdDwWM])$/.exec(resolution.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  switch (m[2]) {
    case 'm':
      return n * 60;
    case 'h':
    case 'H':
      return n * 3600;
    case 'd':
    case 'D':
      return n * 86_400;
    case 'w':
    case 'W':
      return n * 7 * 86_400;
    // 'M' (calendar month) is variable-length — not gap-detectable by a
    // fixed second count.
    default:
      return null;
  }
}

/**
 * Scan a buffer for gaps: places where consecutive candle timestamps differ
 * by more than `intervalSeconds`. A tolerance factor absorbs minor jitter
 * (e.g. exchange timestamps that drift by a few seconds) so only genuine
 * missing-candle runs are reported.
 *
 * @param buffer The candle buffer to scan.
 * @param intervalSeconds Expected spacing between candles (see
 *   `resolutionToSeconds`). Must be > 0.
 * @param tolerance Multiplier applied to `intervalSeconds` as the gap
 *   threshold. Default `1.5` — a gap is reported when `dt > interval * 1.5`.
 */
export function findGaps(
  buffer: CandleBuffer,
  intervalSeconds: number,
  tolerance = 1.5,
): CandleGap[] {
  const gaps: CandleGap[] = [];
  if (!(intervalSeconds > 0) || buffer.length < 2) return gaps;

  const threshold = intervalSeconds * tolerance;
  let prev = buffer.candleAt(0);
  for (let i = 1; i < buffer.length; i++) {
    const cur = buffer.candleAt(i);
    if (!prev || !cur) {
      prev = cur;
      continue;
    }
    const dt = cur.t - prev.t;
    if (dt > threshold) {
      gaps.push({
        fromIndex: i - 1,
        toIndex: i,
        fromTime: prev.t,
        toTime: cur.t,
        missingCount: Math.max(1, Math.round(dt / intervalSeconds) - 1),
      });
    }
    prev = cur;
  }
  return gaps;
}
