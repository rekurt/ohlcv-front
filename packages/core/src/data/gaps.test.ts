import { describe, it, expect } from 'vitest';
import { findGaps, resolutionToSeconds } from './gaps';
import { CandleBuffer } from './CandleBuffer';
import type { Candle } from '../types';

const MIN = 60;

function buf(times: number[]): CandleBuffer {
  const b = new CandleBuffer();
  times.forEach((t) => {
    const c: Candle = { o: 1, h: 1, l: 1, c: 1, v: 1, t };
    b.append(c);
  });
  return b;
}

describe('resolutionToSeconds', () => {
  it('parses minute / hour / day / week resolutions', () => {
    expect(resolutionToSeconds('1m')).toBe(60);
    expect(resolutionToSeconds('15m')).toBe(900);
    expect(resolutionToSeconds('1H')).toBe(3600);
    expect(resolutionToSeconds('1h')).toBe(3600);
    expect(resolutionToSeconds('4H')).toBe(4 * 3600);
    expect(resolutionToSeconds('1D')).toBe(86_400);
    expect(resolutionToSeconds('1W')).toBe(7 * 86_400);
  });

  it('returns null for calendar months and unknown strings', () => {
    expect(resolutionToSeconds('1M')).toBeNull();
    expect(resolutionToSeconds('banana')).toBeNull();
    expect(resolutionToSeconds('0m')).toBeNull();
    expect(resolutionToSeconds('')).toBeNull();
  });
});

describe('findGaps', () => {
  it('returns no gaps for evenly-spaced candles', () => {
    const b = buf([0, MIN, 2 * MIN, 3 * MIN]);
    expect(findGaps(b, MIN)).toEqual([]);
  });

  it('detects a single missing-candle gap', () => {
    // Missing the candle at t=2*MIN.
    const b = buf([0, MIN, 3 * MIN, 4 * MIN]);
    const gaps = findGaps(b, MIN);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      fromIndex: 1,
      toIndex: 2,
      fromTime: MIN,
      toTime: 3 * MIN,
      missingCount: 1,
    });
  });

  it('estimates the number of missing candles', () => {
    // 5-interval jump → 4 missing.
    const b = buf([0, MIN, 6 * MIN]);
    const gaps = findGaps(b, MIN);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.missingCount).toBe(4);
  });

  it('tolerates minor timestamp jitter below the threshold', () => {
    // dt = 1.4 * interval < 1.5 threshold → no gap.
    const b = buf([0, MIN, MIN + Math.round(MIN * 1.4)]);
    expect(findGaps(b, MIN)).toEqual([]);
  });

  it('returns empty for degenerate inputs', () => {
    expect(findGaps(buf([]), MIN)).toEqual([]);
    expect(findGaps(buf([0]), MIN)).toEqual([]);
    expect(findGaps(buf([0, MIN]), 0)).toEqual([]);
  });

  it('finds multiple gaps', () => {
    const b = buf([0, MIN, 5 * MIN, 6 * MIN, 10 * MIN]);
    const gaps = findGaps(b, MIN);
    expect(gaps).toHaveLength(2);
    expect(gaps[0]!.fromIndex).toBe(1);
    expect(gaps[1]!.fromIndex).toBe(3);
  });
});
