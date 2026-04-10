import type { Viewport } from './Viewport';
import type { CandleBuffer } from '../data/CandleBuffer';

export interface KeyboardCallbacks {
  onViewportChange?: () => void;
  onGoToLive?: () => void;
  onFitAll?: () => void;
  onFitVisible?: () => void;
}

/**
 * Keyboard shortcuts for chart navigation. Attached to a focusable HTMLElement
 * (the top canvas with `tabindex=0`). Active only when the element has focus,
 * so page-level shortcuts are not captured.
 *
 * | Key                 | Action                              |
 * | ------------------- | ----------------------------------- |
 * | ← / →               | Pan by 5 candles                    |
 * | Shift + ← / →       | Pan by 25 candles                   |
 * | ↑ / ↓               | Zoom in / out                       |
 * | + / =               | Zoom in                             |
 * | - / _               | Zoom out                            |
 * | Home                | Jump to the oldest candle           |
 * | End                 | Go to live edge (re-enable follow)  |
 * | 0                   | Fit visible (reset candleWidth)     |
 * | F                   | Fit all (show entire buffer)        |
 */
export class KeyboardController {
  private _element: HTMLElement;
  private _viewport: Viewport;
  private _buffer: CandleBuffer;
  private _callbacks: KeyboardCallbacks;
  private _onKeyDown: (e: KeyboardEvent) => void;

  constructor(
    element: HTMLElement,
    viewport: Viewport,
    buffer: CandleBuffer,
    callbacks: KeyboardCallbacks = {},
  ) {
    this._element = element;
    this._viewport = viewport;
    this._buffer = buffer;
    this._callbacks = callbacks;
    this._onKeyDown = this._handleKeyDown.bind(this);
    element.addEventListener('keydown', this._onKeyDown);
  }

  destroy(): void {
    this._element.removeEventListener('keydown', this._onKeyDown);
  }

  private _handleKeyDown(e: KeyboardEvent): void {
    const step = e.shiftKey ? 25 : 5;
    const zoomIn = 1.2;
    const zoomOut = 1 / zoomIn;
    const centerX = (this._viewport.layout.chartLeft + this._viewport.layout.chartRight) / 2;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        this._viewport.pan(-step);
        this._callbacks.onViewportChange?.();
        break;
      case 'ArrowRight':
        e.preventDefault();
        this._viewport.pan(step);
        this._callbacks.onViewportChange?.();
        break;
      case 'ArrowUp':
      case '+':
      case '=':
        e.preventDefault();
        this._viewport.zoom(zoomIn, centerX);
        this._callbacks.onViewportChange?.();
        break;
      case 'ArrowDown':
      case '-':
      case '_':
        e.preventDefault();
        this._viewport.zoom(zoomOut, centerX);
        this._callbacks.onViewportChange?.();
        break;
      case 'Home':
        e.preventDefault();
        this._viewport.startIndex = 0;
        this._viewport.autoFollow = false;
        this._callbacks.onViewportChange?.();
        break;
      case 'End':
        e.preventDefault();
        this._callbacks.onGoToLive?.();
        break;
      case '0':
        e.preventDefault();
        this._callbacks.onFitVisible?.();
        break;
      case 'f':
      case 'F':
        e.preventDefault();
        this._callbacks.onFitAll?.();
        break;
    }
  }
}
