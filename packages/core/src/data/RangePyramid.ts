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
  private _builtLastTime = Number.NaN;

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
    const lastTime = this._buffer.lastTime();
    const blockCount = Math.ceil(len / BLOCK);
    // Incremental rebuild is safe only for a true append (length grew, head
    // unchanged) or an in-place last-bar update (same length AND same first
    // AND last timestamps — what updateLast produces, since it preserves the
    // last candle's time). A full reload that happens to keep the same length
    // and firstTime but rewrote middle candles will differ in lastTime (or
    // length) and falls through to a full rebuild, so stale middle blocks
    // can't survive.
    const headUnchanged = this._builtLength >= 0 && firstTime === this._builtFirstTime;
    const grew = len > this._builtLength;
    const sameTail = len === this._builtLength && lastTime === this._builtLastTime;
    const tailOnly =
      headUnchanged && blockCount <= this._blockMinLow.length && (grew || sameTail);

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
    this._builtLastTime = lastTime;
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
