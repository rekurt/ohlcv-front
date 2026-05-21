import type { Viewport } from './Viewport';
import { MOMENTUM_FRICTION, MOMENTUM_THRESHOLD } from '../constants';

/**
 * Check the `prefers-reduced-motion` media query. Safe to call from non-DOM
 * environments (SSR, tests) — returns false when `matchMedia` is missing.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export interface PanZoomCallbacks {
  onViewportChange?: () => void;
  onPanToStart?: () => void;
  /**
   * Optional resolver for the idle cursor (used on mouseup after drag).
   * Returns the CSS cursor string the canvas should show when no drag
   * is in progress. Default: `'crosshair'`.
   */
  getIdleCursor?: () => string;
  /**
   * Optional callback fired on mousedown and mouseup so the engine can
   * track whether a drag is currently in progress (for `setIdleCursor`
   * defer logic).
   */
  onDragStateChange?: (dragging: boolean) => void;
}

export class PanZoomController {
  private _viewport: Viewport;
  private _canvas: HTMLCanvasElement;
  private _callbacks: PanZoomCallbacks;

  // Mouse state
  private _isDragging = false;
  /**
   * True when the active drag started inside the right-edge price
   * axis strip — drag direction adjusts price-scale instead of
   * panning candles.
   */
  private _isPriceScaleDrag = false;
  private _priceScaleAnchorY = 0;
  private _lastMouseX = 0;
  private _lastMouseY = 0;

  // Touch state
  private _lastTouchDist = 0;
  private _touchStartX = 0;
  /** Center X of a two-finger gesture, for simultaneous pan + pinch. */
  private _lastTouchCenterX = 0;

  // Momentum
  private _velocity = 0;
  private _momentumRafId = 0;
  private _lastDragTime = 0;
  private _lastDragDelta = 0;

  // Bound handlers
  private _onMouseDown: (e: MouseEvent) => void;
  private _onMouseMove: (e: MouseEvent) => void;
  private _onMouseUp: (e: MouseEvent) => void;
  private _onWheel: (e: WheelEvent) => void;
  private _onTouchStart: (e: TouchEvent) => void;
  private _onTouchMove: (e: TouchEvent) => void;
  private _onTouchEnd: (e: TouchEvent) => void;

  constructor(canvas: HTMLCanvasElement, viewport: Viewport, callbacks: PanZoomCallbacks = {}) {
    this._viewport = viewport;
    this._canvas = canvas;
    this._callbacks = callbacks;

    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onMouseUp = this._handleMouseUp.bind(this);
    this._onWheel = this._handleWheel.bind(this);
    this._onTouchStart = this._handleTouchStart.bind(this);
    this._onTouchMove = this._handleTouchMove.bind(this);
    this._onTouchEnd = this._handleTouchEnd.bind(this);

    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this._onTouchEnd);
  }

  destroy(): void {
    this._canvas.removeEventListener('mousedown', this._onMouseDown);
    this._canvas.removeEventListener('wheel', this._onWheel);
    this._canvas.removeEventListener('touchstart', this._onTouchStart);
    this._canvas.removeEventListener('touchmove', this._onTouchMove);
    this._canvas.removeEventListener('touchend', this._onTouchEnd);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);
    if (this._momentumRafId) cancelAnimationFrame(this._momentumRafId);
  }

  private _handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    this._isDragging = true;

    // Detect drag-start in the price-axis strip (right-edge column
    // reserved for price labels). Dragging there rescales Y instead
    // of panning candles.
    const rect = this._canvas.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const layout = this._viewport.layout;
    this._isPriceScaleDrag = !!layout && localX >= layout.chartRight;
    this._priceScaleAnchorY = localY;

    this._lastMouseX = e.clientX;
    this._lastMouseY = e.clientY;
    this._velocity = 0;
    this._lastDragTime = Date.now();
    if (this._momentumRafId) {
      cancelAnimationFrame(this._momentumRafId);
      this._momentumRafId = 0;
    }
    this._canvas.style.cursor = this._isPriceScaleDrag ? 'ns-resize' : 'grabbing';
    this._callbacks.onDragStateChange?.(true);
    // Ensure the canvas receives keyboard events for keyboard shortcuts.
    this._canvas.focus();
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  }

  private _handleMouseMove(e: MouseEvent): void {
    if (!this._isDragging) return;
    const dx = e.clientX - this._lastMouseX;
    const dy = e.clientY - this._lastMouseY;

    if (this._isPriceScaleDrag) {
      // Drag down → expand range (zoom out, factor > 1); drag up →
      // contract (zoom in). The ratio is gentle (5 px per 1%) so the
      // user can scale precisely. Anchor at the original mousedown Y
      // so the price under the cursor stays put.
      if (dy !== 0) {
        const factor = 1 + dy / 200;
        this._viewport.scalePriceRangeBy(factor, this._priceScaleAnchorY);
        this._notifyChange();
      }
      this._lastMouseX = e.clientX;
      this._lastMouseY = e.clientY;
      return;
    }

    const deltaIndex = -dx / this._viewport.candleStep;
    const now = Date.now();
    const dt = now - this._lastDragTime;
    if (dt > 0) {
      this._lastDragDelta = deltaIndex;
      this._lastDragTime = now;
    }

    this._viewport.pan(deltaIndex);
    this._lastMouseX = e.clientX;
    this._lastMouseY = e.clientY;
    this._notifyChange();
    this._checkPanToStart();
  }

  private _handleMouseUp(_e: MouseEvent): void {
    const wasPriceScaleDrag = this._isPriceScaleDrag;
    this._isDragging = false;
    this._isPriceScaleDrag = false;
    // Ask the engine what cursor to show in the resting state — drawing
    // tools override this via `ChartEngine.setIdleCursor`.
    const idle = this._callbacks.getIdleCursor?.() ?? 'crosshair';
    this._canvas.style.cursor = idle;
    this._callbacks.onDragStateChange?.(false);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);

    // Skip momentum for price-axis drags — they're rare, precise
    // adjustments where overshoot would feel jittery.
    if (wasPriceScaleDrag) return;

    // Start momentum — respect `prefers-reduced-motion` to avoid
    // disorienting users with vestibular sensitivity.
    this._velocity = this._lastDragDelta;
    if (Math.abs(this._velocity) > MOMENTUM_THRESHOLD && !prefersReducedMotion()) {
      this._startMomentum();
    }
  }

  /**
   * Wheel / trackpad handling:
   *  - Shift + wheel                                    → pan horizontally
   *  - horizontal swipe with bias                       → pan horizontally
   *  - plain vertical wheel                             → smooth zoom at cursor
   *
   * The horizontal bias is important: macOS trackpads often emit wheel
   * events with a significant deltaX **and** a smaller-but-nonzero deltaY
   * during a horizontal two-finger swipe. A strict `|deltaX| > |deltaY|`
   * check misclassifies such events as zoom. We accept a swipe as horizontal
   * when deltaX is at least half of deltaY (i.e. horizontal is ≥33% of the
   * total motion), which captures real-world trackpad jitter while still
   * leaving clearly-vertical mouse-wheel events (deltaY >> deltaX) to zoom.
   *
   * `preventDefault()` is always called so the page never scrolls on a
   * wheel event that lands on the chart.
   */
  private _handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this._canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const { deltaX, deltaY, shiftKey } = e;

    // 1. Shift+wheel → pan (mouse-wheel fallback for horizontal)
    if (shiftKey && deltaY !== 0) {
      this._viewport.panPixels(-deltaY);
      this._notifyChange();
      this._checkPanToStart();
      return;
    }

    // 2. Horizontal swipe with bias → pan. deltaX must be meaningfully
    //    non-zero AND at least half of deltaY in magnitude for this to be
    //    treated as a swipe instead of a zoom with tilt-wheel jitter.
    if (Math.abs(deltaX) > 0.5 && Math.abs(deltaX) * 2 >= Math.abs(deltaY)) {
      this._viewport.panPixels(-deltaX);
      this._notifyChange();
      this._checkPanToStart();
      return;
    }

    // 3. Plain vertical wheel → smooth magnitude-aware zoom around the cursor
    if (deltaY !== 0) {
      const rawFactor = Math.exp(-deltaY * 0.002);
      const factor = Math.max(0.1, Math.min(10, rawFactor));
      this._viewport.zoom(factor, x);
      this._notifyChange();
      this._checkPanToStart();
    }
  }

  private _handleTouchStart(e: TouchEvent): void {
    e.preventDefault();
    const t0 = e.touches[0];
    if (e.touches.length === 1 && t0) {
      this._touchStartX = t0.clientX;
      this._velocity = 0;
      this._lastDragTime = Date.now();
      if (this._momentumRafId) {
        cancelAnimationFrame(this._momentumRafId);
        this._momentumRafId = 0;
      }
    } else if (e.touches.length === 2) {
      const a = e.touches[0];
      const b = e.touches[1];
      this._lastTouchDist = this._getTouchDistance(e.touches);
      if (a && b) this._lastTouchCenterX = (a.clientX + b.clientX) / 2;
    }
  }

  private _handleTouchMove(e: TouchEvent): void {
    e.preventDefault();
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    if (e.touches.length === 1 && t0) {
      const dx = t0.clientX - this._touchStartX;
      const deltaIndex = -dx / this._viewport.candleStep;

      const now = Date.now();
      const dt = now - this._lastDragTime;
      if (dt > 0) {
        this._lastDragDelta = deltaIndex;
        this._lastDragTime = now;
      }

      this._viewport.pan(deltaIndex);
      this._touchStartX = t0.clientX;
      this._notifyChange();
      this._checkPanToStart();
    } else if (e.touches.length === 2 && t0 && t1) {
      // Two-finger gesture: simultaneous pinch-zoom + pan. The change
      // in finger distance drives zoom; the movement of the gesture
      // center drives pan. A pure spread/pinch leaves the center
      // roughly fixed (no pan); two fingers sliding together leave the
      // distance roughly fixed (no zoom). Both can happen at once.
      const dist = this._getTouchDistance(e.touches);
      const centerX = (t0.clientX + t1.clientX) / 2;
      const rect = this._canvas.getBoundingClientRect();
      const localCenterX = centerX - rect.left;

      // Pan from center movement first, so the zoom anchor uses the
      // already-panned position.
      if (this._lastTouchCenterX !== 0) {
        const dxCenter = centerX - this._lastTouchCenterX;
        if (dxCenter !== 0) this._viewport.panPixels(dxCenter);
      }

      if (this._lastTouchDist > 0) {
        const factor = dist / this._lastTouchDist;
        // Ignore micro-jitter so a pure pan doesn't accumulate zoom drift.
        if (Math.abs(factor - 1) > 0.005) {
          this._viewport.zoom(factor, localCenterX);
        }
      }

      this._notifyChange();
      this._checkPanToStart();
      this._lastTouchDist = dist;
      this._lastTouchCenterX = centerX;
    }
  }

  private _handleTouchEnd(e: TouchEvent): void {
    if (e.touches.length === 0) {
      this._velocity = this._lastDragDelta;
      if (Math.abs(this._velocity) > MOMENTUM_THRESHOLD) {
        this._startMomentum();
      }
    }
    this._lastTouchDist = 0;
    this._lastTouchCenterX = 0;
  }

  private _startMomentum(): void {
    const tick = () => {
      this._velocity *= MOMENTUM_FRICTION;
      if (Math.abs(this._velocity) < 0.01) {
        this._momentumRafId = 0;
        return;
      }
      this._viewport.pan(this._velocity);
      this._notifyChange();
      this._checkPanToStart();
      this._momentumRafId = requestAnimationFrame(tick);
    };
    this._momentumRafId = requestAnimationFrame(tick);
  }

  private _getTouchDistance(touches: TouchList): number {
    const t0 = touches[0];
    const t1 = touches[1];
    if (!t0 || !t1) return 0;
    const dx = t0.clientX - t1.clientX;
    const dy = t0.clientY - t1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private _notifyChange(): void {
    this._callbacks.onViewportChange?.();
  }

  private _checkPanToStart(): void {
    if (this._viewport.isAtStart()) {
      this._callbacks.onPanToStart?.();
    }
  }
}
