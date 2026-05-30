import type { ChartLayout, CandleView } from '../types';
import {
  DEFAULT_CANDLE_WIDTH,
  MIN_CANDLE_WIDTH,
  MIN_CANDLE_WIDTH_FIT,
  MAX_CANDLE_WIDTH,
  CANDLE_GAP_RATIO,
  PRICE_PADDING_RATIO,
  RANGE_ACCEL_THRESHOLD,
} from '../constants';
import { clamp, niceGridValues, niceLogGridValues, formatPercent } from '../utils';
import { CandleBuffer } from '../data/CandleBuffer';
import {
  type PriceScaleMode,
  priceToTransformed,
  transformedToPrice,
} from './priceScale';

/**
 * A single price-axis grid line: the price it sits at, its Y pixel, and
 * a pre-formatted label. `label` is `null` for price-based modes
 * (linear/log) so the renderer can apply the host's custom price
 * formatter; it is a ready string for percentage/indexed modes whose
 * axis reads percentages, not prices.
 */
export interface GridTick {
  price: number;
  y: number;
  label: string | null;
}

/**
 * Optional coarse range index passed to {@link Viewport.autoScale} so a
 * huge (sub-pixel `fitAll`) visible window doesn't get scanned candle-by-
 * candle every frame. Structural so the viewport stays decoupled from the
 * concrete `RangePyramid`.
 */
export interface RangeSource {
  rangeOf(start: number, end: number): { minLow: number; maxHigh: number; maxVol: number };
}

export class Viewport {
  startIndex = 0;
  visibleCount = 0;
  candleWidth = DEFAULT_CANDLE_WIDTH;
  priceMin = 0;
  priceMax = 0;
  volumeMax = 0;
  layout!: ChartLayout;

  /**
   * Number of empty-candle slots kept between the last candle and the right
   * edge of the chart area. Leaves breathing room for the forming live candle.
   */
  rightPaddingCandles = 5;

  /**
   * When true, new data appended to the buffer auto-scrolls the viewport to
   * keep the newest candle in view. Set to false automatically when the user
   * pans away from the right edge, and back to true when they pan back or
   * explicitly call `goToLive()`.
   */
  autoFollow = true;

  /**
   * When true, `autoScale()` is skipped — `priceMin`/`priceMax` stay
   * frozen at the user-chosen range. Set by `scalePriceRangeBy()` when
   * the user drags the price axis. Cleared by `resetPriceScale()`.
   */
  manualPriceScale = false;

  /**
   * Active price-axis transform. `'linear'` keeps the original render
   * path byte-for-byte; `'log'`/`'percentage'`/`'indexedTo100'` route
   * through {@link priceToTransformed}. Set via {@link setScaleMode}.
   */
  scaleMode: PriceScaleMode = 'linear';

  /**
   * Anchor for percentage / indexedTo100 modes — the first visible
   * candle's close. Recomputed every `autoScale` (so it tracks
   * horizontal scroll); frozen while `manualPriceScale` is on so the
   * %-axis doesn't jump during a price-axis drag.
   */
  private _priceBase = 0;

  private _bufferLength = 0;

  /**
   * Non-uniform horizontal mapping: logical index → 0..1 position across the
   * chart width. Set by the engine for value-based (e.g. yield-curve)
   * horizontal scales; null for the default uniform index spacing, where
   * indexToX/xToIndex use the original closed-form arithmetic unchanged.
   */
  private _coord01: ((index: number) => number) | null = null;

  // --- transformed-extrema cache -------------------------------------
  // priceToY/yToPrice are called thousands of times per frame; cache the
  // transformed min/max and recompute only when an input changed. The
  // cache is keyed on the raw inputs (not refreshed by autoScale alone)
  // so direct priceMin/priceMax mutations in tests stay correct.
  private _txMode: PriceScaleMode | null = null;
  private _txMin = 0;
  private _txMax = 0;
  private _txBase = 0;
  private _tMin = 0;
  private _tMax = 0;

  setLayout(layout: ChartLayout): void {
    this.layout = layout;
    this._recalcVisibleCount();
  }

  /** Total width per candle (body + gap) */
  get candleStep(): number {
    return this.candleWidth + this.candleWidth * CANDLE_GAP_RATIO;
  }

  /** Convert buffer index to X pixel coordinate */
  indexToX(index: number): number {
    if (this._coord01) {
      return this.layout.chartLeft + this._coord01(index) * (this.layout.chartRight - this.layout.chartLeft);
    }
    return this.layout.chartLeft + (index - this.startIndex) * this.candleStep + this.candleWidth / 2;
  }

  /** Convert X pixel to nearest buffer index */
  xToIndex(x: number): number {
    if (this._coord01) {
      return this._coord01ToIndex(x);
    }
    return Math.round((x - this.layout.chartLeft - this.candleWidth / 2) / this.candleStep + this.startIndex);
  }

  /**
   * Install a non-uniform index→0..1 horizontal mapping (value-based scales),
   * or pass null to restore uniform index spacing. The default is null, so
   * the standard time chart's geometry is untouched.
   */
  setCoordinateMapping(fn: ((index: number) => number) | null): void {
    this._coord01 = fn;
  }

  /** Inverse of the non-uniform mapping: nearest index for a pixel X. */
  private _coord01ToIndex(x: number): number {
    const fn = this._coord01!;
    if (this._bufferLength <= 0) return 0;
    const chartWidth = this.layout.chartRight - this.layout.chartLeft;
    const target = chartWidth === 0 ? 0 : (x - this.layout.chartLeft) / chartWidth;
    let lo = Math.max(0, Math.floor(this.startIndex));
    let hi = Math.max(lo, Math.min(this._bufferLength - 1, Math.ceil(this.startIndex + this.visibleCount)));
    // coord01 increases monotonically with index (sorted domain) → binary
    // search for the first index whose coord01 >= target.
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (fn(mid) < target) lo = mid + 1;
      else hi = mid;
    }
    // Pick whichever of (lo-1, lo) sits nearer the cursor.
    if (lo > 0 && Math.abs(fn(lo - 1) - target) <= Math.abs(fn(lo) - target)) return lo - 1;
    return lo;
  }

  /** Convert price to Y pixel coordinate */
  priceToY(price: number): number {
    // Linear fast-path: identical arithmetic to the pre-F1 implementation
    // so the default render path stays bit-for-bit unchanged.
    if (this.scaleMode === 'linear') {
      const range = this.priceMax - this.priceMin;
      if (range === 0) return (this.layout.chartTop + this.layout.chartBottom) / 2;
      return this.layout.chartTop + (1 - (price - this.priceMin) / range) * (this.layout.chartBottom - this.layout.chartTop);
    }
    this._ensureTransform();
    const tRange = this._tMax - this._tMin;
    if (tRange === 0) return (this.layout.chartTop + this.layout.chartBottom) / 2;
    const t = priceToTransformed(price, this.scaleMode, this._priceBase);
    return this.layout.chartTop + (1 - (t - this._tMin) / tRange) * (this.layout.chartBottom - this.layout.chartTop);
  }

  /** Convert Y pixel to price */
  yToPrice(y: number): number {
    const chartHeight = this.layout.chartBottom - this.layout.chartTop;
    if (chartHeight === 0) return this.priceMin;
    if (this.scaleMode === 'linear') {
      return this.priceMax - ((y - this.layout.chartTop) / chartHeight) * (this.priceMax - this.priceMin);
    }
    this._ensureTransform();
    const t = this._tMax - ((y - this.layout.chartTop) / chartHeight) * (this._tMax - this._tMin);
    return transformedToPrice(t, this.scaleMode, this._priceBase);
  }

  /**
   * Recompute the cached transformed extrema if any input changed.
   * Cheap no-op on a cache hit (the common case within a frame).
   */
  private _ensureTransform(): void {
    if (
      this._txMode === this.scaleMode &&
      this._txMin === this.priceMin &&
      this._txMax === this.priceMax &&
      this._txBase === this._priceBase
    ) {
      return;
    }
    this._txMode = this.scaleMode;
    this._txMin = this.priceMin;
    this._txMax = this.priceMax;
    this._txBase = this._priceBase;
    this._tMin = priceToTransformed(this.priceMin, this.scaleMode, this._priceBase);
    this._tMax = priceToTransformed(this.priceMax, this.scaleMode, this._priceBase);
  }

  /**
   * Switch the price-axis transform. Clears any manual (frozen) scale so
   * the next `autoScale` re-derives a sane range for the new mode.
   */
  setScaleMode(mode: PriceScaleMode): void {
    if (this.scaleMode === mode) return;
    this.scaleMode = mode;
    this.manualPriceScale = false;
    this._txMode = null; // invalidate transform cache
  }

  /**
   * Price-axis grid ticks for the current scale mode. Shared by the
   * grid renderer and the price-axis renderer so they never diverge.
   * For linear/log, `label` is null (caller formats the price); for
   * percentage/indexed, `label` is the pre-formatted axis string.
   */
  gridTicks(maxTicks = 6): GridTick[] {
    const out: GridTick[] = [];
    if (this.scaleMode === 'log') {
      for (const price of niceLogGridValues(this.priceMin, this.priceMax, maxTicks)) {
        out.push({ price, y: this.priceToY(price), label: null });
      }
      return out;
    }
    if (this.scaleMode === 'percentage' || this.scaleMode === 'indexedTo100') {
      const base = this._priceBase;
      const mode = this.scaleMode;
      const tMin = priceToTransformed(this.priceMin, mode, base);
      const tMax = priceToTransformed(this.priceMax, mode, base);
      for (const t of niceGridValues(tMin, tMax, maxTicks)) {
        const price = transformedToPrice(t, mode, base);
        const label = mode === 'percentage' ? formatPercent(t) : t.toFixed(2);
        out.push({ price, y: this.priceToY(price), label });
      }
      return out;
    }
    // Linear
    for (const price of niceGridValues(this.priceMin, this.priceMax, maxTicks)) {
      out.push({ price, y: this.priceToY(price), label: null });
    }
    return out;
  }

  /** Convert volume to Y pixel coordinate */
  volumeToY(volume: number): number {
    if (this.volumeMax === 0) return this.layout.volumeBottom;
    const ratio = volume / this.volumeMax;
    return this.layout.volumeBottom - ratio * (this.layout.volumeBottom - this.layout.volumeTop);
  }

  /** Pan by delta index units */
  pan(deltaIndex: number): void {
    this.startIndex += deltaIndex;
    this._clampRange();
    this._updateAutoFollow();
  }

  /**
   * Pan by a pixel delta (as reported by wheel or touch events).
   * Positive `dx` means the content moves right (show older candles);
   * negative `dx` means the content moves left (show newer candles).
   */
  panPixels(dx: number): void {
    if (this.candleStep === 0) return;
    this.pan(-dx / this.candleStep);
  }

  /** Zoom around a center X coordinate */
  zoom(factor: number, centerX: number): void {
    const centerIndex = this.xToIndex(centerX);
    const newWidth = clamp(this.candleWidth * factor, MIN_CANDLE_WIDTH, MAX_CANDLE_WIDTH);

    if (newWidth === this.candleWidth) return;
    this.candleWidth = newWidth;
    this._recalcVisibleCount();

    // Preserve the candle under the cursor
    const newCenterOffset = (centerX - this.layout.chartLeft - this.candleWidth / 2) / this.candleStep;
    this.startIndex = centerIndex - newCenterOffset;
    this._clampRange();
  }

  /**
   * Auto-scale price/volume from the visible buffer data.
   *
   * `accel` (optional) is a coarse range index used only when the visible
   * window is huge (sub-pixel `fitAll`) and the mode isn't log — it turns a
   * per-frame O(window) scan into ≈ O(window / block). Omit it and the
   * original linear scan runs, preserving all four guards (manual-mode
   * volume rescan, empty window, NaN-skip, flat-range).
   */
  autoScale(buffer: CandleBuffer, accel?: RangeSource): void {
    this._bufferLength = buffer.length;

    const start = Math.max(0, Math.floor(this.startIndex));
    const end = Math.min(buffer.length, Math.ceil(this.startIndex + this.visibleCount));
    const windowSize = end - start;
    // Log mode's ≤0 skip needs per-candle filtering the coarse index can't
    // do, so log always uses the linear scan.
    const accelOk =
      accel != null && windowSize > RANGE_ACCEL_THRESHOLD && this.scaleMode !== 'log';

    // Manual scale mode (user dragged the price axis): keep priceMin/
    // priceMax frozen, but still refresh volumeMax so volume bars track.
    if (this.manualPriceScale) {
      if (start >= end) {
        this.volumeMax = 0;
        return;
      }
      if (accelOk) {
        this.volumeMax = accel!.rangeOf(start, end).maxVol;
      } else {
        let maxVol = 0;
        const viewM = buffer.sliceView(start, end);
        for (let i = 0; i < viewM.length; i++) {
          const v = viewM.volume[i]!;
          if (Number.isFinite(v) && v > maxVol) maxVol = v;
        }
        this.volumeMax = maxVol;
      }
      return;
    }

    // Empty visible window (no data, zero-width chart) — reset to a
    // safe default range so priceToY doesn't divide by zero.
    if (start >= end) {
      if (this.priceMin === this.priceMax) {
        this.priceMin = 0;
        this.priceMax = 1;
        this.volumeMax = 0;
      }
      return;
    }

    // In log mode a non-positive price has no position on the axis, so
    // those candles must not pull the range down to (or below) zero.
    const isLog = this.scaleMode === 'log';
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxVol = 0;

    if (accelOk) {
      const r = accel!.rangeOf(start, end);
      minPrice = r.minLow;
      maxPrice = r.maxHigh;
      maxVol = r.maxVol;
    } else {
      // Scan visible candles for price extrema, skipping NaN/±Infinity
      // entries so one corrupt candle can't poison the whole range.
      const view = buffer.sliceView(start, end);
      for (let i = 0; i < view.length; i++) {
        const lo = view.low[i]!;
        const hi = view.high[i]!;
        const vol = view.volume[i]!;
        if (Number.isFinite(lo) && (!isLog || lo > 0) && lo < minPrice) minPrice = lo;
        if (Number.isFinite(hi) && (!isLog || hi > 0) && hi > maxPrice) maxPrice = hi;
        if (Number.isFinite(vol) && vol > maxVol) maxVol = vol;
      }
    }

    // Every candle in the window was NaN/Infinity (or non-positive in
    // log mode). Keep the previous range (don't overwrite with Infinity
    // sentinels) — the chart will render empty space but won't crash.
    if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) {
      return;
    }

    // Percentage / indexed modes anchor on the first visible finite close.
    // Recomputed every frame so the base tracks horizontal scroll (frozen
    // in manual mode via the early return above). Bounded probe keeps this
    // O(1)-ish even on the accelerated huge-window path.
    if (this.scaleMode === 'percentage' || this.scaleMode === 'indexedTo100') {
      const probe = buffer.sliceView(start, Math.min(end, start + 256));
      for (let i = 0; i < probe.length; i++) {
        const c = probe.close[i]!;
        if (Number.isFinite(c)) {
          this._priceBase = c;
          break;
        }
      }
    }

    this._applyPriceRange(minPrice, maxPrice);
    this.volumeMax = maxVol;
  }

  /**
   * Apply flat-range protection + mode-aware padding to a raw [min, max]
   * pair and commit it to priceMin/priceMax. Shared by autoScale and
   * autoScaleFromView so both paths pad identically.
   */
  private _applyPriceRange(minPrice: number, maxPrice: number): void {
    let range = maxPrice - minPrice;
    if (range === 0) {
      const padding = Math.abs(maxPrice) * 0.01 || 1;
      minPrice -= padding;
      maxPrice += padding;
      range = maxPrice - minPrice;
    }
    if (this.scaleMode === 'log') {
      // Pad in log space — a linear 5% pad on a log axis squashes the top.
      const logMin = Math.log(minPrice);
      const logMax = Math.log(maxPrice);
      const logPad = (logMax - logMin) * PRICE_PADDING_RATIO;
      this.priceMin = Math.exp(logMin - logPad);
      this.priceMax = Math.exp(logMax + logPad);
    } else {
      const pad = range * PRICE_PADDING_RATIO;
      this.priceMin = minPrice - pad;
      this.priceMax = maxPrice + pad;
    }
  }

  /**
   * Auto-scale from a pre-built (possibly transformed) view rather than the
   * raw buffer — used by series with a `transformView` (Heikin-Ashi) or a
   * custom `priceRange`. Scans the view linearly (no range pyramid). Honors
   * the same manual / empty / NaN / log / flat-range guards as autoScale.
   */
  autoScaleFromView(
    buffer: CandleBuffer,
    view: CandleView,
    priceRange?: (v: CandleView, i: number) => { min: number; max: number },
  ): void {
    this._bufferLength = buffer.length;

    if (this.manualPriceScale) {
      let maxVol = 0;
      for (let i = 0; i < view.length; i++) {
        const v = view.volume[i]!;
        if (Number.isFinite(v) && v > maxVol) maxVol = v;
      }
      this.volumeMax = maxVol;
      return;
    }

    if (view.length === 0) {
      if (this.priceMin === this.priceMax) {
        this.priceMin = 0;
        this.priceMax = 1;
        this.volumeMax = 0;
      }
      return;
    }

    const isLog = this.scaleMode === 'log';
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxVol = 0;
    for (let i = 0; i < view.length; i++) {
      let lo: number;
      let hi: number;
      if (priceRange) {
        const r = priceRange(view, i);
        lo = r.min;
        hi = r.max;
      } else {
        lo = view.low[i]!;
        hi = view.high[i]!;
      }
      const vol = view.volume[i]!;
      if (Number.isFinite(lo) && (!isLog || lo > 0) && lo < minPrice) minPrice = lo;
      if (Number.isFinite(hi) && (!isLog || hi > 0) && hi > maxPrice) maxPrice = hi;
      if (Number.isFinite(vol) && vol > maxVol) maxVol = vol;
    }

    if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) return;

    if (this.scaleMode === 'percentage' || this.scaleMode === 'indexedTo100') {
      for (let i = 0; i < view.length; i++) {
        const c = view.close[i]!;
        if (Number.isFinite(c)) {
          this._priceBase = c;
          break;
        }
      }
    }

    this._applyPriceRange(minPrice, maxPrice);
    this.volumeMax = maxVol;
  }

  /**
   * Scale the price range by `factor` around an anchor Y coordinate
   * (the pixel under the user's cursor at drag-start). `factor > 1`
   * expands the visible range (zoom out vertically — shorter candles),
   * `factor < 1` contracts it (zoom in vertically — taller candles).
   *
   * Switches the viewport to manual price-scale mode — subsequent
   * `autoScale()` calls are skipped until `resetPriceScale()` is
   * called.
   */
  scalePriceRangeBy(factor: number, anchorY: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    // Clamp factor so a single drag can't blow the range out by 1000×.
    const safeFactor = clamp(factor, 0.05, 20);
    const mode = this.scaleMode;
    const base = this._priceBase;
    // Scale in TRANSFORMED space so a log/percentage axis drag stays
    // even across decades. For linear this reduces to the original
    // price-space formula bit-for-bit (the transform is the identity).
    const anchorPrice = this.yToPrice(anchorY);
    const tAnchor = priceToTransformed(anchorPrice, mode, base);
    const tMin = priceToTransformed(this.priceMin, mode, base);
    const tMax = priceToTransformed(this.priceMax, mode, base);
    const newMin = transformedToPrice(tAnchor - (tAnchor - tMin) * safeFactor, mode, base);
    const newMax = transformedToPrice(tAnchor + (tMax - tAnchor) * safeFactor, mode, base);
    if (!Number.isFinite(newMin) || !Number.isFinite(newMax) || newMin >= newMax) return;
    this.priceMin = newMin;
    this.priceMax = newMax;
    this.manualPriceScale = true;
  }

  /**
   * Exit manual price-scale mode; the next `autoScale()` call will
   * recompute `priceMin`/`priceMax` from the visible candles again.
   */
  resetPriceScale(): void {
    this.manualPriceScale = false;
  }

  /** Scroll to the end of data, leaving rightPaddingCandles of empty space. */
  scrollToEnd(bufferLength: number): void {
    this._bufferLength = bufferLength;
    this.startIndex = Math.max(0, bufferLength - this.visibleCount + this.rightPaddingCandles);
    this._clampRange();
  }

  /**
   * Fit all candles from the buffer into the visible chart area by adjusting
   * candleWidth. Useful for "show me everything" action. Scrolls to the start.
   */
  fitAll(bufferLength: number): void {
    this._bufferLength = bufferLength;
    if (bufferLength <= 0) return;
    const chartWidth = this.layout.chartRight - this.layout.chartLeft;
    const stepForAll = chartWidth / bufferLength;
    const rawWidth = stepForAll / (1 + CANDLE_GAP_RATIO);
    // Use the sub-pixel fit floor (not MIN_CANDLE_WIDTH) so "fit all" truly
    // shows the entire buffer — even millions of bars. At sub-pixel widths
    // the conflation render path collapses to one bar per pixel column.
    this.candleWidth = clamp(rawWidth, MIN_CANDLE_WIDTH_FIT, MAX_CANDLE_WIDTH);
    this._recalcVisibleCount();
    this.startIndex = 0;
    this.autoFollow = false;
  }

  /**
   * Reset candleWidth to the default value and scroll to the live edge.
   * Useful for "back to normal" action after deep zoom. Also resets
   * the manual price scale so the next auto-scale runs from scratch.
   */
  fitVisible(bufferLength: number): void {
    this.candleWidth = DEFAULT_CANDLE_WIDTH;
    this._recalcVisibleCount();
    this.autoFollow = true;
    this.manualPriceScale = false;
    this.scrollToEnd(bufferLength);
  }

  /**
   * Scroll to the live edge without changing candleWidth. Re-enables autoFollow.
   */
  goToLive(bufferLength: number): void {
    this.autoFollow = true;
    this.scrollToEnd(bufferLength);
  }

  /**
   * True only when the viewport is resting exactly at the live anchor
   * position (last candle sits at chartRight - rightPaddingCandles).
   *
   * The tolerance is < 0.5 candle so that fractional pan deltas from
   * panPixels() still snap cleanly. Panning even one full candle past the
   * anchor into the empty future zone counts as "user exploring the future"
   * and returns false — which prevents live updates from jerking the view
   * back to the anchor on every tick.
   */
  isAtEnd(): boolean {
    if (this._bufferLength === 0) return true;
    const anchor = this._bufferLength - this.visibleCount + this.rightPaddingCandles;
    return Math.abs(this.startIndex - anchor) < 0.5;
  }

  /** Check if viewport is at the start of data */
  isAtStart(): boolean {
    return this.startIndex <= 0;
  }

  private _recalcVisibleCount(): void {
    if (!this.layout) return;
    const chartWidth = this.layout.chartRight - this.layout.chartLeft;
    this.visibleCount = Math.floor(chartWidth / this.candleStep);
  }

  private _clampRange(): void {
    // Allow scrolling a bit past the end: enough to show right padding plus
    // half a screen of extra empty space for overshoot momentum.
    const maxStart = Math.max(
      0,
      this._bufferLength - this.visibleCount + this.rightPaddingCandles + this.visibleCount / 2,
    );
    // Allow scrolling before start (half screen of empty space)
    const minStart = -this.visibleCount / 2;
    this.startIndex = clamp(this.startIndex, minStart, maxStart);
  }

  /**
   * Update autoFollow based on whether the viewport is still at the live edge.
   * Called after every pan. When the user pans back, we stop following live;
   * when they pan forward to the edge, we start following again.
   */
  private _updateAutoFollow(): void {
    if (this._bufferLength === 0) return;
    this.autoFollow = this.isAtEnd();
  }
}
