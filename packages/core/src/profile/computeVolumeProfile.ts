import type { CandleView } from '../types';

/**
 * One horizontal price bin of a {@link VolumeProfile}: the volume that traded
 * (proportionally) inside the half-open price band `[priceLow, priceHigh)`
 * across the analyzed candles.
 */
export interface VolumeBin {
  /** Lower price edge of the bin (inclusive). */
  priceLow: number;
  /** Upper price edge of the bin (exclusive, except the top bin which is closed). */
  priceHigh: number;
  /** Total volume attributed to this bin. */
  volume: number;
}

/**
 * Horizontal volume distribution over a price range, plus the derived
 * Point-of-Control and Value-Area summary.
 */
export interface VolumeProfile {
  /** Bins ordered low→high price. Length is the requested `bins` (≥ 1). */
  bins: VolumeBin[];
  /**
   * Index into {@link bins} of the Point of Control — the single bin with the
   * most volume. `-1` only when there is no volume at all (every bin empty).
   */
  pocIndex: number;
  /** Lower price edge of the value area (the `priceLow` of its lowest bin). */
  valueAreaLow: number;
  /** Upper price edge of the value area (the `priceHigh` of its highest bin). */
  valueAreaHigh: number;
  /** Sum of all bin volumes (finite candle volume that fell inside the range). */
  totalVolume: number;
}

/**
 * C4 — Volume Profile. Bin the volume of every candle in `view` across the
 * price range `[priceMin, priceMax]`, split into `bins` equal-width intervals.
 *
 * Distribution model: each candle's volume is spread over the bins its
 * `[low, high]` range overlaps, **proportionally to the overlap length** — a
 * candle spanning three bins evenly contributes a third of its volume to each;
 * one whose range covers only the top half of a bin contributes only that
 * fraction. A candle with `low == high` (or whose range collapses to a point
 * after clamping) drops its whole volume into the single bin containing that
 * price. Volume of candles entirely outside `[priceMin, priceMax]` is clamped
 * to the nearest edge bin (so an off-range bar still counts toward
 * `totalVolume` rather than silently vanishing).
 *
 * `pocIndex` is the highest-volume bin. The **value area** is the smallest set
 * of contiguous bins around the POC whose summed volume reaches
 * `valueAreaPct` (default 0.70) of `totalVolume`, grown one bin at a time
 * toward whichever adjacent side holds more volume — the standard
 * market-profile expansion. Its price extent is returned as
 * `valueAreaLow`/`valueAreaHigh`.
 *
 * NaN-safe: candles with a non-finite `low`, `high`, or `volume`, or
 * non-positive volume, are skipped. A degenerate request (`bins < 1`, a
 * non-finite or inverted price range) yields a single empty bin spanning the
 * (repaired) range with `pocIndex = -1`. Pure; allocates only the result.
 */
export function computeVolumeProfile(
  view: CandleView,
  bins: number,
  priceMin: number,
  priceMax: number,
  opts?: { valueAreaPct?: number },
): VolumeProfile {
  const binCount = Number.isFinite(bins) ? Math.max(1, Math.floor(bins)) : 1;

  // Repair a degenerate price range so binning never divides by zero. An
  // inverted pair is swapped; a flat/non-finite pair is padded to a unit band.
  let lo = priceMin;
  let hi = priceMax;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  } else if (lo > hi) {
    const t = lo;
    lo = hi;
    hi = t;
  }
  if (hi - lo <= 0) {
    const pad = Math.abs(hi) * 0.01 || 1;
    lo -= pad;
    hi += pad;
  }

  const range = hi - lo;
  const binSize = range / binCount;

  // Build empty bins (low→high). The top bin is closed at `hi`.
  const result: VolumeBin[] = new Array(binCount);
  const volumes = new Float64Array(binCount);
  for (let b = 0; b < binCount; b++) {
    const bl = lo + b * binSize;
    const bh = b === binCount - 1 ? hi : lo + (b + 1) * binSize;
    result[b] = { priceLow: bl, priceHigh: bh, volume: 0 };
  }

  // Distribute each candle's volume across the bins its [low, high] overlaps.
  for (let i = 0; i < view.length; i++) {
    const vol = view.volume[i]!;
    if (!Number.isFinite(vol) || vol <= 0) continue;
    let cLow = view.low[i]!;
    let cHigh = view.high[i]!;
    if (!Number.isFinite(cLow) || !Number.isFinite(cHigh)) continue;
    if (cLow > cHigh) {
      const t = cLow;
      cLow = cHigh;
      cHigh = t;
    }
    // Clamp the candle's range into the profile range so off-range volume
    // lands in the nearest edge bin instead of being discarded.
    const clampedLow = cLow < lo ? lo : cLow > hi ? hi : cLow;
    const clampedHigh = cHigh < lo ? lo : cHigh > hi ? hi : cHigh;

    const span = clampedHigh - clampedLow;
    if (span <= 0) {
      // Point candle (low == high, or fully outside → clamped to one edge):
      // whole volume into the single bin containing that price.
      const b = binIndexOf(clampedLow, lo, binSize, binCount);
      volumes[b]! += vol;
      continue;
    }

    // Spread proportionally across the overlapped bins. For each bin the
    // candle touches, attribute vol * (overlap / span).
    const firstBin = binIndexOf(clampedLow, lo, binSize, binCount);
    const lastBin = binIndexOf(clampedHigh, lo, binSize, binCount);
    for (let b = firstBin; b <= lastBin; b++) {
      const binLow = lo + b * binSize;
      const binHigh = b === binCount - 1 ? hi : lo + (b + 1) * binSize;
      const overlap = Math.min(clampedHigh, binHigh) - Math.max(clampedLow, binLow);
      if (overlap > 0) volumes[b]! += vol * (overlap / span);
    }
  }

  let total = 0;
  let pocIndex = -1;
  let pocVolume = -Infinity;
  for (let b = 0; b < binCount; b++) {
    const v = volumes[b]!;
    result[b]!.volume = v;
    total += v;
    if (v > pocVolume) {
      pocVolume = v;
      pocIndex = b;
    }
  }

  // No volume anywhere → no POC, value area spans the whole range.
  if (total <= 0 || pocIndex < 0) {
    return {
      bins: result,
      pocIndex: -1,
      valueAreaLow: lo,
      valueAreaHigh: hi,
      totalVolume: 0,
    };
  }

  const pct = clampPct(opts?.valueAreaPct);
  const target = total * pct;

  // Grow the value area outward from the POC, one bin at a time toward the
  // neighbor holding more volume, until the accumulated volume reaches target.
  let vaLowIdx = pocIndex;
  let vaHighIdx = pocIndex;
  let acc = volumes[pocIndex]!;
  while (acc < target && (vaLowIdx > 0 || vaHighIdx < binCount - 1)) {
    const below = vaLowIdx > 0 ? volumes[vaLowIdx - 1]! : -Infinity;
    const above = vaHighIdx < binCount - 1 ? volumes[vaHighIdx + 1]! : -Infinity;
    if (above >= below) {
      vaHighIdx++;
      acc += above;
    } else {
      vaLowIdx--;
      acc += below;
    }
  }

  return {
    bins: result,
    pocIndex,
    valueAreaLow: result[vaLowIdx]!.priceLow,
    valueAreaHigh: result[vaHighIdx]!.priceHigh,
    totalVolume: total,
  };
}

/**
 * Bin index for a price, clamped into `[0, binCount - 1]`. A price exactly on
 * `hi` (the top edge) maps to the last bin rather than overflowing.
 */
function binIndexOf(price: number, lo: number, binSize: number, binCount: number): number {
  if (binSize <= 0) return 0;
  const idx = Math.floor((price - lo) / binSize);
  if (idx < 0) return 0;
  if (idx >= binCount) return binCount - 1;
  return idx;
}

/** Clamp the value-area fraction into (0, 1], defaulting to 0.70. */
function clampPct(pct: number | undefined): number {
  if (pct === undefined || !Number.isFinite(pct)) return 0.7;
  if (pct <= 0) return 0.7;
  if (pct > 1) return 1;
  return pct;
}
