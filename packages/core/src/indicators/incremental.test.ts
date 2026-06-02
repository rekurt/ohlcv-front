import { describe, it, expect } from 'vitest';
import { CandleBuffer } from '../data/CandleBuffer';
import type { Candle } from '../types';
import type { Indicator, IndicatorSeries } from './Indicator';
import { SMA } from './SMA';
import { EMA } from './EMA';
import { WMA } from './WMA';
import { ROC } from './ROC';
import { OBV } from './OBV';
import { BollingerBands } from './BollingerBands';
import { Donchian } from './Donchian';
import { RSI } from './RSI';

/**
 * Equivalence tests for the incremental `updateTail` fast path on
 * `Indicator.computeCached`. For every indicator that implements the
 * hook, a realtime `updateLast` or single `append` routed through
 * `computeCached` must produce output byte-for-byte equivalent to a
 * fresh full `compute` on the mutated buffer — that is the entire
 * correctness contract of the feature.
 */

/**
 * Build a non-trivial candle. Highs/lows straddle the close with a bit
 * of asymmetric noise so high/low-driven indicators (Donchian) and
 * volume-driven ones (OBV) actually exercise distinct values per bar.
 */
function makeCandle(i: number, close: number): Candle {
  const wiggle = ((i * 7) % 5) * 0.3;
  return {
    o: close - 0.5,
    h: close + 1 + wiggle,
    l: close - 1 - ((i * 3) % 4) * 0.25,
    c: close,
    v: 100 + ((i * 13) % 37),
    t: 1_700_000_000 + i * 60,
  };
}

/**
 * A deliberately jagged close series of length `n`: a rising drift with
 * a sinusoidal ripple so consecutive closes go both up and down (needed
 * to exercise OBV's sign branch and to keep Bollinger stdev non-zero).
 */
function closesOf(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(100 + i * 0.8 + Math.sin(i * 0.7) * 6 + ((i * 11) % 9));
  }
  return out;
}

function bufferOfCloses(closes: number[]): CandleBuffer {
  const buf = new CandleBuffer();
  closes.forEach((c, i) => buf.append(makeCandle(i, c)));
  return buf;
}

/** Compare two IndicatorSeries[] element-wise, NaN-aware. */
function expectSeriesEqual(actual: IndicatorSeries[], expected: IndicatorSeries[]): void {
  expect(actual.length).toBe(expected.length);
  for (let s = 0; s < expected.length; s++) {
    const a = actual[s]!;
    const e = expected[s]!;
    expect(a.name).toBe(e.name);
    expect(a.values.length).toBe(e.values.length);
    for (let i = 0; i < e.values.length; i++) {
      const av = a.values[i]!;
      const ev = e.values[i]!;
      if (Number.isNaN(ev)) {
        expect(Number.isNaN(av), `series "${e.name}" index ${i}: expected NaN, got ${av}`).toBe(
          true,
        );
      } else {
        expect(Number.isNaN(av), `series "${e.name}" index ${i}: got NaN, expected ${ev}`).toBe(
          false,
        );
        expect(av, `series "${e.name}" index ${i}`).toBeCloseTo(ev, 8);
      }
    }
  }
}

/**
 * Drive both the incremental and full paths for an indicator and assert
 * they agree. `make` constructs a fresh indicator instance (so the
 * incremental instance and the reference instance never share a cache).
 */
function checkEquivalence(
  label: string,
  make: () => Indicator,
  closes: number[],
  modifiedLastClose: number,
  appendedClose: number,
): void {
  describe(label, () => {
    it('updateLast: computeCached (incremental) === fresh compute', () => {
      const buf = bufferOfCloses(closes);
      const ind = make();
      // Prime the cache with the full series.
      ind.computeCached(buf);
      // Realtime tick: rewrite the final (in-progress) candle.
      const lastIdx = closes.length - 1;
      buf.updateLast(makeCandle(lastIdx, modifiedLastClose));
      const incremental = ind.computeCached(buf);

      const reference = make().compute(buf);
      expectSeriesEqual(incremental, reference);
    });

    it('append: computeCached (incremental) === fresh compute', () => {
      const buf = bufferOfCloses(closes);
      const ind = make();
      ind.computeCached(buf);
      // Realtime tick: a brand-new candle closes the prior bar and opens one.
      buf.append(makeCandle(closes.length, appendedClose));
      const incremental = ind.computeCached(buf);

      const reference = make().compute(buf);
      expectSeriesEqual(incremental, reference);
    });

    it('append then updateLast in sequence still matches full compute', () => {
      const buf = bufferOfCloses(closes);
      const ind = make();
      ind.computeCached(buf);
      buf.append(makeCandle(closes.length, appendedClose));
      ind.computeCached(buf); // incremental append
      buf.updateLast(makeCandle(closes.length, appendedClose + 3.5));
      const incremental = ind.computeCached(buf); // incremental updateLast on top

      const reference = make().compute(buf);
      expectSeriesEqual(incremental, reference);
    });
  });
}

const N = 60;
const CLOSES = closesOf(N);

describe('incremental indicator updateTail equivalence', () => {
  checkEquivalence('SMA(20)', () => new SMA(20), CLOSES, 173.25, 175.5);
  checkEquivalence('EMA(20)', () => new EMA(20), CLOSES, 173.25, 175.5);
  checkEquivalence('WMA(20)', () => new WMA(20), CLOSES, 173.25, 175.5);
  checkEquivalence('ROC(12)', () => new ROC(12), CLOSES, 173.25, 175.5);
  checkEquivalence('OBV', () => new OBV(), CLOSES, 173.25, 175.5);
  // OBV's tail sign branch (`cc > pc` / `cc < pc`) is only exercised on its
  // boundary when the touched close EQUALS its predecessor. Drive the shared
  // equivalence harness with that exact transition so a `>` → `>=` (or
  // `<` → `<=`) mutation in OBV.updateTail diverges from the unmutated full
  // compute and fails here — not just in the dedicated sign-branch test below.
  //   updateLast rewrites index N-1 to CLOSES[N-2] (== close[N-2] → flat).
  //   append adds index N as CLOSES[N-1]    (== close[N-1] → flat).
  checkEquivalence('OBV (flat close — equality branch)', () => new OBV(), CLOSES, CLOSES[N - 2]!, CLOSES[N - 1]!);
  checkEquivalence('BollingerBands(20,2)', () => new BollingerBands(20, 2), CLOSES, 173.25, 175.5);
  checkEquivalence('Donchian(20)', () => new Donchian(20), CLOSES, 173.25, 175.5);

  // OBV is especially sensitive to the up/down sign of the touched close
  // relative to its predecessor. Exercise both directions explicitly.
  describe('OBV sign branches under updateLast', () => {
    it('matches full compute when the modified close goes DOWN vs prev', () => {
      const buf = bufferOfCloses(CLOSES);
      const ind = new OBV();
      ind.computeCached(buf);
      const prevClose = CLOSES[N - 2]!;
      buf.updateLast(makeCandle(N - 1, prevClose - 5)); // force a down-close
      expectSeriesEqual(ind.computeCached(buf), new OBV().compute(buf));
    });

    it('matches full compute when the modified close goes UP vs prev', () => {
      const buf = bufferOfCloses(CLOSES);
      const ind = new OBV();
      ind.computeCached(buf);
      const prevClose = CLOSES[N - 2]!;
      buf.updateLast(makeCandle(N - 1, prevClose + 5)); // force an up-close
      expectSeriesEqual(ind.computeCached(buf), new OBV().compute(buf));
    });

    it('matches full compute when the modified close EQUALS prev', () => {
      const buf = bufferOfCloses(CLOSES);
      const ind = new OBV();
      ind.computeCached(buf);
      const prevClose = CLOSES[N - 2]!;
      buf.updateLast(makeCandle(N - 1, prevClose)); // flat close
      expectSeriesEqual(ind.computeCached(buf), new OBV().compute(buf));
    });
  });

  // EMA's seed sits at index period-1; an append that lands exactly on the
  // first post-seed index must read the seed from the cached prev series.
  describe('EMA warmup boundary', () => {
    it('append landing one past the seed (i === period) matches full compute', () => {
      // Buffer length == period → only the seed at period-1 is populated.
      const period = 10;
      const closes = closesOf(period);
      const buf = bufferOfCloses(closes);
      const ind = new EMA(period);
      ind.computeCached(buf); // primes cache; only out[period-1] is non-NaN
      buf.append(makeCandle(period, 142.0)); // new index == period, first steady value
      expectSeriesEqual(ind.computeCached(buf), new EMA(period).compute(buf));
    });

    it('updateLast on the seed index itself (i === period-1) matches full compute', () => {
      // Buffer length == period → last index is the seed; updateTail must
      // fall back to full compute (returns null) since the seed is an SMA,
      // not a prior-EMA recurrence.
      const period = 10;
      const closes = closesOf(period);
      const buf = bufferOfCloses(closes);
      const ind = new EMA(period);
      ind.computeCached(buf);
      buf.updateLast(makeCandle(period - 1, 137.0));
      expectSeriesEqual(ind.computeCached(buf), new EMA(period).compute(buf));
    });

    it('updateLast on the first steady index (i === period) reads the seed from prev', () => {
      // Buffer length == period+1 → indices period-1 (seed) and period
      // (first recurrence value) are populated. Rewriting the last candle
      // touches i === period, whose value = close[period]*k + seed*(1-k).
      const period = 10;
      const closes = closesOf(period + 1);
      const buf = bufferOfCloses(closes);
      const ind = new EMA(period);
      ind.computeCached(buf);
      buf.updateLast(makeCandle(period, 151.0));
      expectSeriesEqual(ind.computeCached(buf), new EMA(period).compute(buf));
    });

    it('append while still entirely in warmup (length < period) matches full compute', () => {
      const period = 20;
      const closes = closesOf(period - 3); // shorter than period → all NaN
      const buf = bufferOfCloses(closes);
      const ind = new EMA(period);
      ind.computeCached(buf);
      buf.append(makeCandle(period - 3, 130.0)); // length now period-2, still < period
      expectSeriesEqual(ind.computeCached(buf), new EMA(period).compute(buf));
    });
  });

  // SMA/WMA/BB/Donchian warmup boundary: append that crosses into the first
  // valid window (i === period-1).
  describe('window-indicator warmup boundary (i === period-1)', () => {
    const period = 12;
    const shortCloses = closesOf(period - 1); // last valid index would be period-2 → NaN

    it('SMA append crossing into first window matches full compute', () => {
      const buf = bufferOfCloses(shortCloses);
      const ind = new SMA(period);
      ind.computeCached(buf);
      buf.append(makeCandle(period - 1, 150.0)); // index period-1 → first non-NaN
      expectSeriesEqual(ind.computeCached(buf), new SMA(period).compute(buf));
    });

    it('WMA append crossing into first window matches full compute', () => {
      const buf = bufferOfCloses(shortCloses);
      const ind = new WMA(period);
      ind.computeCached(buf);
      buf.append(makeCandle(period - 1, 150.0));
      expectSeriesEqual(ind.computeCached(buf), new WMA(period).compute(buf));
    });

    it('BollingerBands append crossing into first window matches full compute', () => {
      const buf = bufferOfCloses(shortCloses);
      const ind = new BollingerBands(period, 2);
      ind.computeCached(buf);
      buf.append(makeCandle(period - 1, 150.0));
      expectSeriesEqual(ind.computeCached(buf), new BollingerBands(period, 2).compute(buf));
    });

    it('Donchian append crossing into first window matches full compute', () => {
      const buf = bufferOfCloses(shortCloses);
      const ind = new Donchian(period);
      ind.computeCached(buf);
      buf.append(makeCandle(period - 1, 150.0));
      expectSeriesEqual(ind.computeCached(buf), new Donchian(period).compute(buf));
    });

    it('ROC append crossing into first valid index (i === period) matches full compute', () => {
      const rocPeriod = 12;
      const closes = closesOf(rocPeriod); // indices 0..period-1, all NaN (loop starts at period)
      const buf = bufferOfCloses(closes);
      const ind = new ROC(rocPeriod);
      ind.computeCached(buf);
      buf.append(makeCandle(rocPeriod, 150.0)); // index period → first non-NaN
      expectSeriesEqual(ind.computeCached(buf), new ROC(rocPeriod).compute(buf));
    });
  });

  // Sanity: an indicator WITHOUT updateTail (RSI uses Wilder smoothing,
  // hidden recursive state) must still be correct through computeCached —
  // the full-recompute fallback path runs and matches fresh compute.
  describe('fallback path for indicators without updateTail (RSI)', () => {
    it('updateLast through computeCached === fresh compute', () => {
      const buf = bufferOfCloses(CLOSES);
      const ind = new RSI(14);
      ind.computeCached(buf);
      buf.updateLast(makeCandle(N - 1, 168.0));
      expectSeriesEqual(ind.computeCached(buf), new RSI(14).compute(buf));
    });

    it('append through computeCached === fresh compute', () => {
      const buf = bufferOfCloses(CLOSES);
      const ind = new RSI(14);
      ind.computeCached(buf);
      buf.append(makeCandle(N, 169.5));
      expectSeriesEqual(ind.computeCached(buf), new RSI(14).compute(buf));
    });
  });

  // The incremental path must NOT corrupt a previously returned snapshot:
  // updateTail returns fresh arrays, so a reference captured before the
  // tick keeps its old values.
  describe('previous snapshot is not mutated by an incremental tick', () => {
    it('SMA: old reference is untouched after updateLast', () => {
      const buf = bufferOfCloses(CLOSES);
      const ind = new SMA(20);
      const before = ind.computeCached(buf);
      const beforeCopy = Float64Array.from(before[0]!.values);
      buf.updateLast(makeCandle(N - 1, 999.0)); // wildly different close
      const after = ind.computeCached(buf);
      expect(after).not.toBe(before);
      expect(after[0]!.values).not.toBe(before[0]!.values);
      // The pre-tick snapshot still holds its original values.
      expect(Array.from(before[0]!.values)).toEqual(Array.from(beforeCopy));
    });

    it('EMA: old reference is untouched after append', () => {
      const buf = bufferOfCloses(CLOSES);
      const ind = new EMA(20);
      const before = ind.computeCached(buf);
      const beforeCopy = Float64Array.from(before[0]!.values);
      buf.append(makeCandle(N, 999.0));
      const after = ind.computeCached(buf);
      expect(after[0]!.values).not.toBe(before[0]!.values);
      expect(Array.from(before[0]!.values)).toEqual(Array.from(beforeCopy));
    });
  });

  describe('cache invalidation on clear()+refill (generation guard — P0 review fix)', () => {
    const cases: [string, () => Indicator][] = [
      ['SMA', () => new SMA(10)],
      ['EMA', () => new EMA(10)],
      ['BollingerBands', () => new BollingerBands(10, 2)],
    ];
    for (const [name, make] of cases) {
      it(`${name}: not stale after clear()+refill (same firstTime, same length → updateLast kind)`, () => {
        const buf = bufferOfCloses(closesOf(40)); // dataset A
        const ind = make();
        ind.computeCached(buf); // warm cache on A
        buf.clear(); // generation++
        for (let i = 0; i < 40; i++) buf.append(makeCandle(i, 500 - i * 3)); // dataset B, same len & t[0]
        // Without the generation guard updateTail would copy A's values.
        expectSeriesEqual(ind.computeCached(buf), make().compute(buf));
      });

      it(`${name}: not stale after clear()+refill of length+1 (append kind)`, () => {
        const buf = bufferOfCloses(closesOf(40));
        const ind = make();
        ind.computeCached(buf);
        buf.clear();
        for (let i = 0; i < 41; i++) buf.append(makeCandle(i, 500 - i * 3));
        expectSeriesEqual(ind.computeCached(buf), make().compute(buf));
      });
    }
  });
});
