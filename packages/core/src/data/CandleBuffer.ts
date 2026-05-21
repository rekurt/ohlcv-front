import type { Candle, CandleView } from '../types';
import { INITIAL_CAPACITY, GROWTH_FACTOR } from '../constants';
import { lowerBound } from '../utils';

/**
 * Lightweight runtime assertion for a single candle. Faster than
 * `validateCandle` (which constructs a fresh object and checks for
 * extras) — we only catch the corruption modes that produce hard
 * NaN/Infinity in downstream renderers.
 *
 * Always runs (not gated on dev mode) because the cost is six numeric
 * checks per candle — negligible next to the cost of rendering a
 * single bar — and silent NaN propagation is much more expensive to
 * debug later.
 */
function assertCandleNumeric(c: Candle, where: string): void {
  if (
    !Number.isFinite(c.o) ||
    !Number.isFinite(c.h) ||
    !Number.isFinite(c.l) ||
    !Number.isFinite(c.c) ||
    !Number.isFinite(c.v) ||
    !Number.isFinite(c.t)
  ) {
    throw new RangeError(
      `[ohlcv] CandleBuffer.${where}: candle contains a non-finite OHLCVT field: ${JSON.stringify(c)}`,
    );
  }
}

/**
 * Storage for OHLCVT candles backed by parallel Float64Arrays.
 *
 * Internal model: the raw arrays have a logical `_head` offset. Logical
 * index `i` reads `_open[_head + i]` etc. This lets `prepend()` run in
 * O(1) when there's leftPad headroom — the raw arrays don't have to
 * be re-allocated and copied on every history-page load. When headroom
 * runs out we grow with extra leftPad reserved for future prepends,
 * amortizing the cost to O(1) per candle.
 *
 * Invariants:
 *   _head >= 0
 *   _head + _length <= _capacity
 */
export class CandleBuffer {
  private _open: Float64Array;
  private _high: Float64Array;
  private _low: Float64Array;
  private _close: Float64Array;
  private _volume: Float64Array;
  private _time: Float64Array;
  private _length = 0;
  private _capacity: number;
  private _head = 0;
  private _version = 0;

  constructor(capacity = INITIAL_CAPACITY) {
    this._capacity = capacity;
    this._open = new Float64Array(capacity);
    this._high = new Float64Array(capacity);
    this._low = new Float64Array(capacity);
    this._close = new Float64Array(capacity);
    this._volume = new Float64Array(capacity);
    this._time = new Float64Array(capacity);
  }

  get length(): number {
    return this._length;
  }

  /**
   * Monotonically increasing revision counter, bumped on every mutation
   * (`append`, `appendBatch`, `updateLast`, `prepend`, `clear`). Consumers
   * such as indicators key their memoization cache on this value so they
   * only recompute when the underlying data actually changed — not on every
   * render frame.
   */
  get version(): number {
    return this._version;
  }

  /** O(1) amortized append */
  append(candle: Candle): void {
    assertCandleNumeric(candle, 'append');
    if (this._head + this._length >= this._capacity) this._growTail();
    const i = this._head + this._length;
    this._length++;
    this._open[i] = candle.o;
    this._high[i] = candle.h;
    this._low[i] = candle.l;
    this._close[i] = candle.c;
    this._volume[i] = candle.v;
    this._time[i] = candle.t;
    this._version++;
  }

  /**
   * Batch append with pre-grow.
   *
   * Incoming candles must be sorted ASC by time. If they are not, this
   * method sorts them in place (after copying to avoid mutating the
   * caller's array) before writing — otherwise binary search over
   * `_time` would silently return wrong indices. Also filters out any
   * candles with `t <= lastTime()` to preserve strict monotonicity when
   * combined with existing buffer data.
   */
  appendBatch(candles: Candle[]): void {
    if (candles.length === 0) return;

    // Preserve strict monotonicity: sort if incoming is out of order, and
    // drop any candles that would overlap or predate the current last time.
    let monotonic = true;
    for (let i = 1; i < candles.length; i++) {
      if (candles[i]!.t <= candles[i - 1]!.t) {
        monotonic = false;
        break;
      }
    }
    const sorted = monotonic ? candles : candles.slice().sort((a, b) => a.t - b.t);
    const cutoff =
      this._length > 0 ? this._time[this._head + this._length - 1]! : -Infinity;
    let firstValid = 0;
    while (firstValid < sorted.length && sorted[firstValid]!.t <= cutoff) {
      firstValid++;
    }

    const incoming = sorted.length - firstValid;
    if (incoming === 0) return;

    // Validate the entire range BEFORE mutating buffer state. A
    // failed call must leave the buffer untouched so callers that
    // treat the exception as a full rejection can retry without
    // ending up with silent partial ingestion.
    for (let idx = firstValid; idx < sorted.length; idx++) {
      assertCandleNumeric(sorted[idx]!, 'appendBatch');
    }

    // Ensure trailing capacity. _growTail enlarges the right side; if
    // there's plenty of right-side room already we don't allocate.
    while (this._head + this._length + incoming > this._capacity) this._growTail();
    for (let idx = firstValid; idx < sorted.length; idx++) {
      const c = sorted[idx]!;
      const i = this._head + this._length;
      this._length++;
      this._open[i] = c.o;
      this._high[i] = c.h;
      this._low[i] = c.l;
      this._close[i] = c.c;
      this._volume[i] = c.v;
      this._time[i] = c.t;
    }
    this._version++;
  }

  /** O(1) in-place update of the last candle */
  updateLast(candle: Candle): void {
    if (this._length === 0) return;
    assertCandleNumeric(candle, 'updateLast');
    const i = this._head + this._length - 1;
    this._open[i] = candle.o;
    this._high[i] = candle.h;
    this._low[i] = candle.l;
    this._close[i] = candle.c;
    this._volume[i] = candle.v;
    this._time[i] = candle.t;
    this._version++;
  }

  /**
   * Prepend candles (for lazy history loading). O(1) per candle when
   * leftPad headroom is available; O(n) when growth is required. The
   * growth path reserves leftPad equal to the current length so a
   * sequence of equal-sized history pages amortizes to O(1) per candle
   * — TradingView-style infinite scroll without GC churn.
   *
   * Strict monotonicity: incoming is sorted ASC if not already, and
   * the entire prepended block must be older than the current first
   * candle. Candles violating that invariant are dropped.
   */
  prepend(candles: Candle[]): void {
    if (candles.length === 0) return;

    let monotonic = true;
    for (let i = 1; i < candles.length; i++) {
      if (candles[i]!.t <= candles[i - 1]!.t) {
        monotonic = false;
        break;
      }
    }
    const sorted = monotonic ? candles : candles.slice().sort((a, b) => a.t - b.t);

    // Drop candles that overlap or come after the current first.
    const cutoff = this._length > 0 ? this._time[this._head]! : Infinity;
    let lastValid = sorted.length;
    while (lastValid > 0 && sorted[lastValid - 1]!.t >= cutoff) lastValid--;
    if (lastValid === 0) return;

    const incoming = lastValid;

    // Validate the entire range BEFORE mutating buffer state — same
    // atomicity contract as appendBatch.
    for (let i = 0; i < incoming; i++) {
      assertCandleNumeric(sorted[i]!, 'prepend');
    }

    if (this._head >= incoming) {
      // Fast path: enough leftPad headroom — shift _head left and write
      // in place. No allocations, no copies.
      const newHead = this._head - incoming;
      for (let i = 0; i < incoming; i++) {
        const c = sorted[i]!;
        const idx = newHead + i;
        this._open[idx] = c.o;
        this._high[idx] = c.h;
        this._low[idx] = c.l;
        this._close[idx] = c.c;
        this._volume[idx] = c.v;
        this._time[idx] = c.t;
      }
      this._head = newHead;
      this._length += incoming;
      this._version++;
      return;
    }

    // Slow path: not enough left headroom. Allocate fresh arrays with
    // extra leftPad reserved for future prepends. New leftPad =
    // max(incoming, current length) so the next page should be O(1).
    const reservedLeftPad = Math.max(incoming, this._length);
    const usedRight = this._length;
    let cap = Math.max(this._capacity, reservedLeftPad + usedRight + incoming);
    while (cap < reservedLeftPad + usedRight + incoming) cap *= GROWTH_FACTOR;

    const newOpen = new Float64Array(cap);
    const newHigh = new Float64Array(cap);
    const newLow = new Float64Array(cap);
    const newClose = new Float64Array(cap);
    const newVolume = new Float64Array(cap);
    const newTime = new Float64Array(cap);

    const newHead = reservedLeftPad;

    // Write prepended block at [newHead .. newHead + incoming).
    // Range already validated above.
    for (let i = 0; i < incoming; i++) {
      const c = sorted[i]!;
      const idx = newHead + i;
      newOpen[idx] = c.o;
      newHigh[idx] = c.h;
      newLow[idx] = c.l;
      newClose[idx] = c.c;
      newVolume[idx] = c.v;
      newTime[idx] = c.t;
    }

    // Append the existing block right after.
    const existingDst = newHead + incoming;
    newOpen.set(this._open.subarray(this._head, this._head + this._length), existingDst);
    newHigh.set(this._high.subarray(this._head, this._head + this._length), existingDst);
    newLow.set(this._low.subarray(this._head, this._head + this._length), existingDst);
    newClose.set(this._close.subarray(this._head, this._head + this._length), existingDst);
    newVolume.set(this._volume.subarray(this._head, this._head + this._length), existingDst);
    newTime.set(this._time.subarray(this._head, this._head + this._length), existingDst);

    this._open = newOpen;
    this._high = newHigh;
    this._low = newLow;
    this._close = newClose;
    this._volume = newVolume;
    this._time = newTime;
    this._head = newHead;
    this._length = usedRight + incoming;
    this._capacity = cap;
    this._version++;
  }

  /** Binary search for index by timestamp. Returns exact index or -1 */
  findIndexByTime(timestamp: number): number {
    const rawIdx = lowerBound(
      this._time,
      timestamp,
      this._head,
      this._head + this._length,
    );
    if (rawIdx < this._head + this._length && this._time[rawIdx] === timestamp) {
      return rawIdx - this._head;
    }
    return -1;
  }

  /** Zero-copy slice view via subarray */
  sliceView(start: number, end: number): CandleView {
    const s = Math.max(0, start);
    const e = Math.min(this._length, end);
    const rs = this._head + s;
    const re = this._head + e;
    return {
      open: this._open.subarray(rs, re),
      high: this._high.subarray(rs, re),
      low: this._low.subarray(rs, re),
      close: this._close.subarray(rs, re),
      volume: this._volume.subarray(rs, re),
      time: this._time.subarray(rs, re),
      length: Math.max(0, e - s),
      offset: s,
    };
  }

  /** Get a single candle by index */
  candleAt(index: number): Candle | null {
    if (index < 0 || index >= this._length) return null;
    const i = this._head + index;
    return {
      o: this._open[i]!,
      h: this._high[i]!,
      l: this._low[i]!,
      c: this._close[i]!,
      v: this._volume[i]!,
      t: this._time[i]!,
    };
  }

  lastTime(): number {
    return this._length > 0 ? this._time[this._head + this._length - 1]! : 0;
  }

  firstTime(): number {
    return this._length > 0 ? this._time[this._head]! : 0;
  }

  lastClose(): number {
    return this._length > 0 ? this._close[this._head + this._length - 1]! : 0;
  }

  clear(): void {
    this._length = 0;
    this._head = 0;
    this._version++;
  }

  /**
   * Grow the trailing capacity. Preserves `_head` so leftPad
   * headroom for future prepends is not lost.
   */
  private _growTail(): void {
    const newCap = this._capacity * GROWTH_FACTOR;
    this._open = this._copyGrow(this._open, newCap);
    this._high = this._copyGrow(this._high, newCap);
    this._low = this._copyGrow(this._low, newCap);
    this._close = this._copyGrow(this._close, newCap);
    this._volume = this._copyGrow(this._volume, newCap);
    this._time = this._copyGrow(this._time, newCap);
    this._capacity = newCap;
  }

  private _copyGrow(arr: Float64Array, newCap: number): Float64Array {
    const newArr = new Float64Array(newCap);
    // Copy the entire used range (head + length) so trailing growth
    // doesn't change logical indices.
    newArr.set(arr.subarray(0, this._head + this._length));
    return newArr;
  }
}
