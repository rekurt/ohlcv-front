import type { Viewport } from './Viewport';
import { MOMENTUM_FRICTION, MOMENTUM_THRESHOLD } from '../constants';

export interface PanZoomCallbacks {
  onViewportChange?: () => void;
  onPanToStart?: () => void;
}

export class PanZoomController {
  private _viewport: Viewport;
  private _canvas: HTMLCanvasElement;
  private _callbacks: PanZoomCallbacks;

  // Mouse state
  private _isDragging = false;
  private _lastMouseX = 0;
  private _lastMouseY = 0;

  // Touch state
  private _lastTouchDist = 0;
  private _touchStartX = 0;

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
    this._lastMouseX = e.clientX;
    this._lastMouseY = e.clientY;
    this._velocity = 0;
    this._lastDragTime = Date.now();
    if (this._momentumRafId) {
      cancelAnimationFrame(this._momentumRafId);
      this._momentumRafId = 0;
    }
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  }

  private _handleMouseMove(e: MouseEvent): void {
    if (!this._isDragging) return;
    const dx = e.clientX - this._lastMouseX;
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
    this._isDragging = false;
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);

    // Start momentum
    this._velocity = this._lastDragDelta;
    if (Math.abs(this._velocity) > MOMENTUM_THRESHOLD) {
      this._startMomentum();
    }
  }

  private _handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this._canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    // Zoom factor based on wheel delta
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    this._viewport.zoom(factor, x);
    this._notifyChange();
    this._checkPanToStart();
  }

  private _handleTouchStart(e: TouchEvent): void {
    e.preventDefault();
    if (e.touches.length === 1) {
      this._touchStartX = e.touches[0].clientX;
      this._velocity = 0;
      this._lastDragTime = Date.now();
      if (this._momentumRafId) {
        cancelAnimationFrame(this._momentumRafId);
        this._momentumRafId = 0;
      }
    } else if (e.touches.length === 2) {
      this._lastTouchDist = this._getTouchDistance(e.touches);
    }
  }

  private _handleTouchMove(e: TouchEvent): void {
    e.preventDefault();
    if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - this._touchStartX;
      const deltaIndex = -dx / this._viewport.candleStep;

      const now = Date.now();
      const dt = now - this._lastDragTime;
      if (dt > 0) {
        this._lastDragDelta = deltaIndex;
        this._lastDragTime = now;
      }

      this._viewport.pan(deltaIndex);
      this._touchStartX = e.touches[0].clientX;
      this._notifyChange();
      this._checkPanToStart();
    } else if (e.touches.length === 2) {
      const dist = this._getTouchDistance(e.touches);
      if (this._lastTouchDist > 0) {
        const factor = dist / this._lastTouchDist;
        const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const rect = this._canvas.getBoundingClientRect();
        this._viewport.zoom(factor, centerX - rect.left);
        this._notifyChange();
      }
      this._lastTouchDist = dist;
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
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
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
