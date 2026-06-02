import { Indicator, type IndicatorPlacement, type IndicatorSeries, nanArray } from './Indicator';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * ZigZag — connects significant swing highs and lows, filtering out
 * moves smaller than `deviation` percent. Useful as a structural
 * overlay (Elliott wave / pattern scaffolding) and as the basis for
 * Fibonacci anchoring.
 *
 * The output series carries the swing price at each pivot index and
 * NaN everywhere else; the overlay renderer connects the non-NaN
 * points with straight lines, producing the characteristic zigzag.
 *
 * Algorithm: track the running extreme in the current direction;
 * when price reverses by at least `deviation`% from that extreme,
 * commit the extreme as a pivot and flip direction. This is the
 * standard single-pass percentage ZigZag. Note it is inherently
 * non-causal at the right edge (the last leg can still extend), which
 * is expected behavior for ZigZag.
 */
export class ZigZag extends Indicator {
  readonly placement: IndicatorPlacement = 'overlay';

  constructor(public readonly deviation: number = 5) {
    super();
    if (!Number.isFinite(deviation) || deviation <= 0) {
      throw new Error(`ZigZag deviation must be a positive number (percent), got ${deviation}`);
    }
  }

  get id(): string {
    return `zigzag(${this.deviation})`;
  }

  compute(buffer: CandleBuffer): IndicatorSeries[] {
    const n = buffer.length;
    const out = nanArray(n);
    const view = buffer.sliceView(0, n);
    const high = view.high;
    const low = view.low;
    const close = view.close;
    if (n < 2) {
      if (n === 1) out[0] = close[0]!;
      return [{ name: 'zigzag', values: out }];
    }

    const threshold = this.deviation / 100;

    // First pivot anchored at index 0 (its close).
    out[0] = close[0]!;

    // Single-direction state machine. `dir` is 0 (undecided), +1
    // (in an up-leg, tracking a high) or −1 (down-leg, tracking a low).
    // `extreme*` is the running candidate pivot for the current leg.
    let dir = 0;
    let extremeIdx = 0;
    let extremePrice = close[0]!;

    const commit = (idx: number, price: number) => {
      out[idx] = price;
    };

    for (let i = 1; i < n; i++) {
      const ch = high[i]!;
      const cl = low[i]!;

      if (dir === 0) {
        // Undecided: wait for the first qualifying move from the anchor.
        if (ch >= extremePrice * (1 + threshold)) {
          dir = 1;
          extremeIdx = i;
          extremePrice = ch;
        } else if (cl <= extremePrice * (1 - threshold)) {
          dir = -1;
          extremeIdx = i;
          extremePrice = cl;
        }
        continue;
      }

      if (dir === 1) {
        // Up-leg: extend the high; reverse on a >= deviation% drop.
        if (ch >= extremePrice) {
          extremePrice = ch;
          extremeIdx = i;
        } else if (cl <= extremePrice * (1 - threshold)) {
          commit(extremeIdx, extremePrice); // lock in the swing high
          dir = -1;
          extremePrice = cl;
          extremeIdx = i;
        }
      } else {
        // Down-leg: extend the low; reverse on a >= deviation% rise.
        if (cl <= extremePrice) {
          extremePrice = cl;
          extremeIdx = i;
        } else if (ch >= extremePrice * (1 + threshold)) {
          commit(extremeIdx, extremePrice); // lock in the swing low
          dir = 1;
          extremePrice = ch;
          extremeIdx = i;
        }
      }
    }

    // Commit the final running extreme as the last (provisional) pivot,
    // unless it's still the anchor.
    if (extremeIdx !== 0) commit(extremeIdx, extremePrice);

    return [{ name: 'zigzag', values: out }];
  }
}
