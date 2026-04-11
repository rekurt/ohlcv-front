import type { ChartLayout } from '../types';
import {
  DEFAULT_CANDLE_WIDTH,
  MIN_CANDLE_WIDTH,
  MAX_CANDLE_WIDTH,
  CANDLE_GAP_RATIO,
  PRICE_PADDING_RATIO,
} from '../constants';
import { clamp } from '../utils';
import { CandleBuffer } from '../data/CandleBuffer';

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

  private _bufferLength = 0;

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
    return this.layout.chartLeft + (index - this.startIndex) * this.candleStep + this.candleWidth / 2;
  }

  /** Convert X pixel to nearest buffer index */
  xToIndex(x: number): number {
    return Math.round((x - this.layout.chartLeft - this.candleWidth / 2) / this.candleStep + this.startIndex);
  }

  /** Convert price to Y pixel coordinate */
  priceToY(price: number): number {
    const range = this.priceMax - this.priceMin;
    if (range === 0) return (this.layout.chartTop + this.layout.chartBottom) / 2;
    return this.layout.chartTop + (1 - (price - this.priceMin) / range) * (this.layout.chartBottom - this.layout.chartTop);
  }

  /** Convert Y pixel to price */
  yToPrice(y: number): number {
    const chartHeight = this.layout.chartBottom - this.layout.chartTop;
    if (chartHeight === 0) return this.priceMin;
    return this.priceMax - ((y - this.layout.chartTop) / chartHeight) * (this.priceMax - this.priceMin);
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

  /** Auto-scale price/volume from visible buffer data */
  autoScale(buffer: CandleBuffer): void {
    this._bufferLength = buffer.length;
    const start = Math.max(0, Math.floor(this.startIndex));
    const end = Math.min(buffer.length, Math.ceil(this.startIndex + this.visibleCount));

    if (start >= end) return;

    const view = buffer.sliceView(start, end);
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxVol = 0;

    // Index `i` is bounded by `view.length` which equals the Float64Array
    // subarray length, so direct access is safe. `!` eliminates the strict
    // "possibly undefined" noise introduced by noUncheckedIndexedAccess.
    for (let i = 0; i < view.length; i++) {
      const lo = view.low[i]!;
      const hi = view.high[i]!;
      const vol = view.volume[i]!;
      if (lo < minPrice) minPrice = lo;
      if (hi > maxPrice) maxPrice = hi;
      if (vol > maxVol) maxVol = vol;
    }

    // Flat range protection
    let range = maxPrice - minPrice;
    if (range === 0) {
      const padding = Math.abs(maxPrice) * 0.01 || 1;
      minPrice -= padding;
      maxPrice += padding;
      range = maxPrice - minPrice;
    }

    // Add padding
    const pad = range * PRICE_PADDING_RATIO;
    this.priceMin = minPrice - pad;
    this.priceMax = maxPrice + pad;
    this.volumeMax = maxVol;
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
    this.candleWidth = clamp(rawWidth, MIN_CANDLE_WIDTH, MAX_CANDLE_WIDTH);
    this._recalcVisibleCount();
    this.startIndex = 0;
    this.autoFollow = false;
  }

  /**
   * Reset candleWidth to the default value and scroll to the live edge.
   * Useful for "back to normal" action after deep zoom.
   */
  fitVisible(bufferLength: number): void {
    this.candleWidth = DEFAULT_CANDLE_WIDTH;
    this._recalcVisibleCount();
    this.autoFollow = true;
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
