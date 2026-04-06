import type { ChartLayout, CandleView } from '../types';
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

    for (let i = 0; i < view.length; i++) {
      if (view.low[i] < minPrice) minPrice = view.low[i];
      if (view.high[i] > maxPrice) maxPrice = view.high[i];
      if (view.volume[i] > maxVol) maxVol = view.volume[i];
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

  /** Scroll to the end of data */
  scrollToEnd(bufferLength: number): void {
    this._bufferLength = bufferLength;
    this.startIndex = Math.max(0, bufferLength - this.visibleCount);
    this._clampRange();
  }

  /** Check if viewport is at the end of data */
  isAtEnd(): boolean {
    return this.startIndex + this.visibleCount >= this._bufferLength - 1;
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
    // Allow scrolling a bit past the end (half screen of empty space)
    const maxStart = Math.max(0, this._bufferLength - this.visibleCount / 2);
    // Allow scrolling before start (half screen of empty space)
    const minStart = -this.visibleCount / 2;
    this.startIndex = clamp(this.startIndex, minStart, maxStart);
  }
}
