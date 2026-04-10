/**
 * A horizontal band of the chart with its own Y-axis and price range.
 *
 * `PaneKind` describes how the pane is used:
 * - `price`: the main candlestick/line area. One per chart, id=`main`.
 * - `volume`: the built-in volume sub-pane (optional).
 * - `indicator`: user-added sub-panes for RSI, MACD, stochastic, etc.
 *
 * Each pane owns its own `priceMin/priceMax/volumeMax` auto-scaled state,
 * and can independently toggle linear/log Y-axis.
 *
 * Bounds (`top`/`bottom`) are computed by the parent `PaneLayout` based on
 * each pane's `heightRatio` and the total available chart height.
 */
export type PaneKind = 'price' | 'volume' | 'indicator';
export type YScale = 'linear' | 'log';

export class Pane {
  readonly id: string;
  readonly kind: PaneKind;
  private _heightRatio: number;
  yScale: YScale = 'linear';

  /** Auto-scaled from the buffer on every render. */
  priceMin = 0;
  priceMax = 0;
  volumeMax = 0;

  /** Computed absolute Y coordinates by PaneLayout.computeBounds(). */
  top = 0;
  bottom = 0;

  constructor(id: string, kind: PaneKind, heightRatio: number) {
    this.id = id;
    this.kind = kind;
    this._heightRatio = clampHeight(heightRatio);
  }

  get heightRatio(): number {
    return this._heightRatio;
  }
  set heightRatio(value: number) {
    this._heightRatio = clampHeight(value);
  }

  /** Convert a price value to its Y pixel coordinate within this pane. */
  priceToY(price: number): number {
    const range = this.priceMax - this.priceMin;
    const height = this.bottom - this.top;
    if (range === 0 || height === 0) {
      return (this.top + this.bottom) / 2;
    }
    if (this.yScale === 'log') {
      // Guard against non-positive prices (log undefined).
      const safeMin = this.priceMin <= 0 ? 1e-9 : this.priceMin;
      const safeMax = this.priceMax <= 0 ? safeMin * 10 : this.priceMax;
      const safePrice = price <= 0 ? safeMin : price;
      const logMin = Math.log(safeMin);
      const logMax = Math.log(safeMax);
      const logRange = logMax - logMin;
      if (logRange === 0) return (this.top + this.bottom) / 2;
      const t = (Math.log(safePrice) - logMin) / logRange;
      return this.bottom - t * height;
    }
    // Linear scale
    const t = (price - this.priceMin) / range;
    return this.bottom - t * height;
  }

  /** Inverse of priceToY: convert a Y pixel back to a price value. */
  yToPrice(y: number): number {
    const height = this.bottom - this.top;
    if (height === 0) return this.priceMin;
    const t = (this.bottom - y) / height;
    if (this.yScale === 'log') {
      const safeMin = this.priceMin <= 0 ? 1e-9 : this.priceMin;
      const safeMax = this.priceMax <= 0 ? safeMin * 10 : this.priceMax;
      const logMin = Math.log(safeMin);
      const logMax = Math.log(safeMax);
      return Math.exp(logMin + t * (logMax - logMin));
    }
    return this.priceMin + t * (this.priceMax - this.priceMin);
  }

  /** Convert a volume value to a Y coordinate within this pane. */
  volumeToY(volume: number): number {
    if (this.volumeMax === 0) return this.bottom;
    const ratio = volume / this.volumeMax;
    return this.bottom - ratio * (this.bottom - this.top);
  }
}

function clampHeight(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.01;
  return Math.max(0.01, Math.min(1, ratio));
}

/**
 * Ordered vertical stack of panes. Always contains at least the main price
 * pane (id=`main`, kind=`price`). Sub-panes appended via `addPane` are
 * renormalized so all ratios sum to 1, and `computeBounds(top, bottom)`
 * assigns absolute Y bounds to each.
 */
export class PaneLayout {
  private readonly _panes: Pane[];

  constructor() {
    this._panes = [new Pane('main', 'price', 1)];
  }

  get panes(): readonly Pane[] {
    return this._panes;
  }

  get main(): Pane {
    // `main` is always index 0 by invariant.
    return this._panes[0]!;
  }

  addPane(pane: Pane): void {
    this._panes.push(pane);
    this._renormalize();
  }

  removePane(id: string): void {
    if (id === 'main') return; // cannot remove main
    const idx = this._panes.findIndex((p) => p.id === id);
    if (idx === -1) return;
    this._panes.splice(idx, 1);
    this._renormalize();
  }

  getPane(id: string): Pane | undefined {
    return this._panes.find((p) => p.id === id);
  }

  /**
   * Distribute the [top, bottom] range across panes according to each
   * pane's normalized heightRatio. Every pane gets concrete `top`/`bottom`
   * set after this call.
   */
  computeBounds(top: number, bottom: number): void {
    const totalHeight = bottom - top;
    if (totalHeight <= 0) return;

    let cursor = top;
    for (const pane of this._panes) {
      const h = pane.heightRatio * totalHeight;
      pane.top = cursor;
      pane.bottom = cursor + h;
      cursor += h;
    }
    // Snap last pane's bottom to the target to absorb rounding drift.
    const last = this._panes[this._panes.length - 1];
    if (last) last.bottom = bottom;
  }

  /**
   * Adjust height ratios so that sub-panes (non-main) keep their declared
   * ratios and the main pane absorbs the remaining space. If sub-panes
   * would exceed 1, all ratios are scaled down proportionally.
   */
  private _renormalize(): void {
    const subPanes = this._panes.slice(1);
    const subSum = subPanes.reduce((sum, p) => sum + p.heightRatio, 0);
    if (subSum >= 1) {
      // All sub-panes together exceed full height — shrink them and give
      // main a tiny sliver so the user still sees price data.
      const scale = 0.9 / subSum;
      for (const p of subPanes) p.heightRatio = p.heightRatio * scale;
      this.main.heightRatio = 0.1;
      return;
    }
    this.main.heightRatio = 1 - subSum;
  }
}
