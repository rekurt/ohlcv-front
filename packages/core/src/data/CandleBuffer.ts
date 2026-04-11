import type { Candle, CandleView } from '../types';
import { INITIAL_CAPACITY, GROWTH_FACTOR } from '../constants';
import { lowerBound } from '../utils';

export class CandleBuffer {
  private _open: Float64Array;
  private _high: Float64Array;
  private _low: Float64Array;
  private _close: Float64Array;
  private _volume: Float64Array;
  private _time: Float64Array;
  private _length = 0;
  private _capacity: number;

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

  /** O(1) amortized append */
  append(candle: Candle): void {
    if (this._length >= this._capacity) this._grow();
    const i = this._length++;
    this._open[i] = candle.o;
    this._high[i] = candle.h;
    this._low[i] = candle.l;
    this._close[i] = candle.c;
    this._volume[i] = candle.v;
    this._time[i] = candle.t;
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
    const cutoff = this._length > 0 ? this._time[this._length - 1]! : -Infinity;
    let firstValid = 0;
    while (firstValid < sorted.length && sorted[firstValid]!.t <= cutoff) {
      firstValid++;
    }

    const incoming = sorted.length - firstValid;
    if (incoming === 0) return;

    const needed = this._length + incoming;
    while (this._capacity < needed) this._grow();
    for (let idx = firstValid; idx < sorted.length; idx++) {
      const c = sorted[idx]!;
      const i = this._length++;
      this._open[i] = c.o;
      this._high[i] = c.h;
      this._low[i] = c.l;
      this._close[i] = c.c;
      this._volume[i] = c.v;
      this._time[i] = c.t;
    }
  }

  /** O(1) in-place update of the last candle */
  updateLast(candle: Candle): void {
    if (this._length === 0) return;
    const i = this._length - 1;
    this._open[i] = candle.o;
    this._high[i] = candle.h;
    this._low[i] = candle.l;
    this._close[i] = candle.c;
    this._volume[i] = candle.v;
    this._time[i] = candle.t;
  }

  /**
   * Prepend candles (for lazy history loading).
   *
   * The caller is responsible for ensuring prepended candles are strictly
   * older than the current `firstTime()`; this method additionally sorts
   * the incoming array in place by time to guarantee internal monotonicity
   * even if the caller passes an unsorted batch. Without this sort, a
   * subsequent `findIndexByTime` / `lowerBound` would silently return
   * wrong answers.
   */
  prepend(candles: Candle[]): void {
    if (candles.length === 0) return;

    // Sort incoming by time ASC. Skip the sort if the array is already
    // monotonic — typical for well-formed history responses.
    let monotonic = true;
    for (let i = 1; i < candles.length; i++) {
      if (candles[i]!.t <= candles[i - 1]!.t) {
        monotonic = false;
        break;
      }
    }
    const sorted = monotonic ? candles : candles.slice().sort((a, b) => a.t - b.t);

    const newLen = this._length + sorted.length;
    let cap = this._capacity;
    while (cap < newLen) cap *= GROWTH_FACTOR;

    const newOpen = new Float64Array(cap);
    const newHigh = new Float64Array(cap);
    const newLow = new Float64Array(cap);
    const newClose = new Float64Array(cap);
    const newVolume = new Float64Array(cap);
    const newTime = new Float64Array(cap);

    // Write prepended candles first. Use direct iteration to avoid repeated
    // array lookups and satisfy noUncheckedIndexedAccess.
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i]!;
      newOpen[i] = c.o;
      newHigh[i] = c.h;
      newLow[i] = c.l;
      newClose[i] = c.c;
      newVolume[i] = c.v;
      newTime[i] = c.t;
    }

    // Copy existing data after
    const offset = sorted.length;
    newOpen.set(this._open.subarray(0, this._length), offset);
    newHigh.set(this._high.subarray(0, this._length), offset);
    newLow.set(this._low.subarray(0, this._length), offset);
    newClose.set(this._close.subarray(0, this._length), offset);
    newVolume.set(this._volume.subarray(0, this._length), offset);
    newTime.set(this._time.subarray(0, this._length), offset);

    this._open = newOpen;
    this._high = newHigh;
    this._low = newLow;
    this._close = newClose;
    this._volume = newVolume;
    this._time = newTime;
    this._capacity = cap;
    this._length = newLen;
  }

  /** Binary search for index by timestamp. Returns exact index or -1 */
  findIndexByTime(timestamp: number): number {
    const idx = lowerBound(this._time, timestamp, 0, this._length);
    if (idx < this._length && this._time[idx] === timestamp) return idx;
    return -1;
  }

  /** Zero-copy slice view via subarray */
  sliceView(start: number, end: number): CandleView {
    const s = Math.max(0, start);
    const e = Math.min(this._length, end);
    return {
      open: this._open.subarray(s, e),
      high: this._high.subarray(s, e),
      low: this._low.subarray(s, e),
      close: this._close.subarray(s, e),
      volume: this._volume.subarray(s, e),
      time: this._time.subarray(s, e),
      length: Math.max(0, e - s),
      offset: s,
    };
  }

  /** Get a single candle by index */
  candleAt(index: number): Candle | null {
    if (index < 0 || index >= this._length) return null;
    // Index bounds are validated above; TypedArray access is guaranteed safe.
    return {
      o: this._open[index]!,
      h: this._high[index]!,
      l: this._low[index]!,
      c: this._close[index]!,
      v: this._volume[index]!,
      t: this._time[index]!,
    };
  }

  lastTime(): number {
    return this._length > 0 ? this._time[this._length - 1]! : 0;
  }

  firstTime(): number {
    return this._length > 0 ? this._time[0]! : 0;
  }

  lastClose(): number {
    return this._length > 0 ? this._close[this._length - 1]! : 0;
  }

  clear(): void {
    this._length = 0;
  }

  private _grow(): void {
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
    newArr.set(arr.subarray(0, this._length));
    return newArr;
  }
}
