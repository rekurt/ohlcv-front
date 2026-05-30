import type { CandleBuffer } from './CandleBuffer';

/** Min-low / max-high / max-volume over a candle index range. */
export interface PriceVolumeRange {
  minLow: number;
  maxHigh: number;
  maxVol: number;
}

/**
 * Candles per coarse-mip block. A 1M-candle buffer needs ~4000 blocks ×
 * 3 Float64Arrays ≈ 96 KB — three orders of magnitude lighter than a full
 * power-of-two pyramid (~48 MB) while still turning a full-zoom-out range
 * query from O(n) into ≈ O(n / BLOCK) + two ≤BLOCK partial scans.
 */
const BLOCK = 256;

/**
 * Lazily-built coarse range index over a {@link CandleBuffer}, used to
 * accelerate `Viewport.autoScale` once the visible window grows past a few
 * thousand candles (only reachable with sub-pixel `fitAll`). For the common
 * zoomed-in case the window is small and the viewport keeps using its plain
 * linear scan — this structure is never even built.
 *
 * Freshness: rebuilds incrementally on append/updateLast (only the tail
 * block(s) recompute); rebuilds fully when the buffer head moves
 * (prepend/evict, detected via `firstTime`) or shrinks.
 */
export class RangePyramid {
  private readonly _buffer: CandleBuffer;
  private _blockMinLow = new Float64Array(0);
  private _blockMaxHigh = new Float64Array(0);
  private _blockMaxVol = new Float64Array(0);
  private _builtVersion = -1;
  private _builtLength = -1;
  private _builtFirstTime = Number.NaN;
  private _builtGeneration = -1;

  constructor(buffer: CandleBuffer) {
    this._buffer = buffer;
  }

  /** NaN-safe min-low / max-high / max-vol over candle indices [start, end). */
  rangeOf(start: number, end: number): PriceVolumeRange {
    this._ensureFresh();
    const len = this._buffer.length;
    const s = Math.max(0, Math.floor(start));
    const e = Math.min(len, Math.ceil(end));
    if (s >= e) return { minLow: Infinity, maxHigh: -Infinity, maxVol: 0 };

    const firstFullBlock = Math.ceil(s / BLOCK);
    const lastFullBlockEnd = Math.floor(e / BLOCK); // exclusive block index
    if (firstFullBlock >= lastFullBlockEnd) {
      // Range doesn't fully contain a single block — raw scan is cheapest.
      return this._scanRaw(s, e);
    }

    let minLow = Infinity;
    let maxHigh = -Infinity;
    let maxVol = 0;

    const head = this._scanRaw(s, firstFullBlock * BLOCK);
    if (head.minLow < minLow) minLow = head.minLow;
    if (head.maxHigh > maxHigh) maxHigh = head.maxHigh;
    if (head.maxVol > maxVol) maxVol = head.maxVol;

    for (let b = firstFullBlock; b < lastFullBlockEnd; b++) {
      const ml = this._blockMinLow[b]!;
      const mh = this._blockMaxHigh[b]!;
      const mv = this._blockMaxVol[b]!;
      if (ml < minLow) minLow = ml;
      if (mh > maxHigh) maxHigh = mh;
      if (mv > maxVol) maxVol = mv;
    }

    const tail = this._scanRaw(lastFullBlockEnd * BLOCK, e);
    if (tail.minLow < minLow) minLow = tail.minLow;
    if (tail.maxHigh > maxHigh) maxHigh = tail.maxHigh;
    if (tail.maxVol > maxVol) maxVol = tail.maxVol;

    return { minLow, maxHigh, maxVol };
  }

  /** Direct NaN-safe scan over [s, e) — mirrors Viewport.autoScale's loop. */
  private _scanRaw(s: number, e: number): PriceVolumeRange {
    if (s >= e) return { minLow: Infinity, maxHigh: -Infinity, maxVol: 0 };
    const view = this._buffer.sliceView(s, e);
    let minLow = Infinity;
    let maxHigh = -Infinity;
    let maxVol = 0;
    for (let i = 0; i < view.length; i++) {
      const lo = view.low[i]!;
      const hi = view.high[i]!;
      const vol = view.volume[i]!;
      if (Number.isFinite(lo) && lo < minLow) minLow = lo;
      if (Number.isFinite(hi) && hi > maxHigh) maxHigh = hi;
      if (Number.isFinite(vol) && vol > maxVol) maxVol = vol;
    }
    return { minLow, maxHigh, maxVol };
  }

  private _ensureFresh(): void {
    const len = this._buffer.length;
    const version = this._buffer.version;
    if (version === this._builtVersion && len === this._builtLength) return;

    const firstTime = this._buffer.firstTime();
    const generation = this._buffer.generation;
    const blockCount = Math.ceil(len / BLOCK);
    // Incremental rebuild is safe only when the existing prefix is provably
    // intact. That's guaranteed when (a) no structural reset happened since
    // the last build (generation unchanged — rules out a setData reload, even
    // one re-establishing the same length/timestamps) AND (b) the head hasn't
    // moved (firstTime unchanged — rules out prepend/evictHead). The only
    // remaining mutations are append/appendBatch/updateLast, all of which
    // leave [0, _builtLength) untouched, so we can rebuild just the tail.
    const tailOnly =
      this._builtLength > 0 &&
      generation === this._builtGeneration &&
      firstTime === this._builtFirstTime &&
      len >= this._builtLength &&
      blockCount <= this._blockMinLow.length;

    if (tailOnly) {
      // Recompute only the last previously-built block (updateLast may have
      // changed it) plus any blocks the new tail added.
      const fromBlock = this._builtLength > 0 ? Math.floor((this._builtLength - 1) / BLOCK) : 0;
      for (let b = fromBlock; b < blockCount; b++) this._buildBlock(b, len);
    } else {
      this._blockMinLow = new Float64Array(blockCount);
      this._blockMaxHigh = new Float64Array(blockCount);
      this._blockMaxVol = new Float64Array(blockCount);
      for (let b = 0; b < blockCount; b++) this._buildBlock(b, len);
    }

    this._builtVersion = version;
    this._builtLength = len;
    this._builtFirstTime = firstTime;
    this._builtGeneration = generation;
  }

  private _buildBlock(b: number, len: number): void {
    const s = b * BLOCK;
    const e = Math.min(len, s + BLOCK);
    const r = this._scanRaw(s, e);
    this._blockMinLow[b] = r.minLow;
    this._blockMaxHigh[b] = r.maxHigh;
    this._blockMaxVol[b] = r.maxVol;
  }
}
