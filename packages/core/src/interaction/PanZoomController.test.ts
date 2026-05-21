import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PanZoomController } from './PanZoomController';
import { Viewport } from './Viewport';
import { computeLayout } from '../utils';

/**
 * Tests for the wheel handling decision table. A trackpad horizontal swipe
 * typically emits wheel events with a significant deltaX and a small but
 * non-zero deltaY jitter. The handler must treat these as pan, not zoom.
 */
describe('PanZoomController._handleWheel decision table', () => {
  let canvas: HTMLCanvasElement;
  let viewport: Viewport;
  let controller: PanZoomController;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 2000;
    canvas.height = 1000;
    document.body.appendChild(canvas);

    viewport = new Viewport();
    viewport.setLayout(computeLayout(1000, 500));
    // Seed a buffer-ish state so pan/zoom actually do something
    viewport.scrollToEnd(500);

    controller = new PanZoomController(canvas, viewport);
  });

  afterEach(() => {
    controller.destroy();
    canvas.remove();
  });

  /**
   * Detect the action the wheel handler took. `candleWidth` changing is the
   * only reliable signal for zoom — startIndex also changes on zoom as a
   * side effect of keeping the candle under the cursor centered, so it
   * can't be used as a "pan happened" marker in isolation.
   */
  function dispatchWheel(opts: Partial<WheelEventInit>): { panned: boolean; zoomed: boolean } {
    const widthBefore = viewport.candleWidth;
    const startBefore = viewport.startIndex;
    const ev = new WheelEvent('wheel', {
      deltaX: 0,
      deltaY: 0,
      clientX: canvas.getBoundingClientRect().left + 500,
      clientY: canvas.getBoundingClientRect().top + 250,
      bubbles: true,
      cancelable: true,
      ...opts,
    });
    canvas.dispatchEvent(ev);
    const zoomed = Math.abs(viewport.candleWidth - widthBefore) > 0.01;
    // Only count pan when candleWidth is unchanged — otherwise the
    // startIndex drift is just zoom centering.
    const panned = !zoomed && Math.abs(viewport.startIndex - startBefore) > 0.01;
    return { panned, zoomed };
  }

  it('pure horizontal swipe → pan only', () => {
    expect(dispatchWheel({ deltaX: 20, deltaY: 0 })).toEqual({ panned: true, zoomed: false });
  });

  it('pure vertical wheel → zoom only', () => {
    expect(dispatchWheel({ deltaX: 0, deltaY: 20 })).toEqual({ panned: false, zoomed: true });
  });

  it('trackpad horizontal swipe with vertical jitter → pan (not zoom)', () => {
    // This is the real-world case: user swipes sideways but the trackpad
    // reports a small deltaY alongside the larger deltaX. The handler MUST
    // interpret this as a horizontal pan.
    expect(dispatchWheel({ deltaX: 20, deltaY: 5 })).toEqual({ panned: true, zoomed: false });
  });

  it('trackpad diagonal swipe — horizontal dominant but smaller → pan', () => {
    // A less-exaggerated horizontal swipe still counts as pan.
    expect(dispatchWheel({ deltaX: 5, deltaY: 3 })).toEqual({ panned: true, zoomed: false });
  });

  it('trackpad diagonal swipe — dy > dx but comparable → pan (bias toward swipe intent)', () => {
    // If deltaX is at least half of deltaY, the user is probably swiping
    // horizontally with heavy vertical jitter, not intentionally zooming.
    expect(dispatchWheel({ deltaX: 5, deltaY: 10 })).toEqual({ panned: true, zoomed: false });
  });

  it('mouse wheel vertical with tilt-wheel jitter → zoom (vertical clearly dominant)', () => {
    // Tilt-wheel mice emit tiny deltaX while scrolling vertically. Must stay
    // a zoom because deltaY dominates by >2×.
    expect(dispatchWheel({ deltaX: 2, deltaY: 100 })).toEqual({ panned: false, zoomed: true });
  });

  it('shift + vertical wheel → pan (remaps dy → horizontal)', () => {
    expect(dispatchWheel({ deltaX: 0, deltaY: 30, shiftKey: true })).toEqual({
      panned: true,
      zoomed: false,
    });
  });

  it('calls preventDefault so the page does not scroll', () => {
    const ev = new WheelEvent('wheel', {
      deltaX: 20,
      deltaY: 0,
      clientX: 500,
      clientY: 250,
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe('PanZoomController two-finger touch gestures', () => {
  let canvas: HTMLCanvasElement;
  let viewport: Viewport;
  let controller: PanZoomController;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 2000;
    canvas.height = 1000;
    document.body.appendChild(canvas);
    viewport = new Viewport();
    viewport.setLayout(computeLayout(1000, 500));
    viewport.scrollToEnd(500);
    controller = new PanZoomController(canvas, viewport);
  });

  afterEach(() => {
    controller.destroy();
    canvas.remove();
  });

  type Pt = { clientX: number; clientY: number };
  // Fake a TouchEvent: jsdom lacks a usable TouchEvent constructor, so
  // build a minimal object with `touches` + `preventDefault` and call
  // the controller's bound handlers directly.
  function touchEvent(points: Pt[]): TouchEvent {
    return {
      touches: points as unknown as TouchList,
      preventDefault() {},
    } as unknown as TouchEvent;
  }
  function call(method: '_onTouchStart' | '_onTouchMove' | '_onTouchEnd', ev: TouchEvent): void {
    (controller as unknown as Record<string, (e: TouchEvent) => void>)[method]!(ev);
  }

  it('two fingers sliding together pan without zooming', () => {
    const widthBefore = viewport.candleWidth;
    const startBefore = viewport.startIndex;
    // Start with both fingers 100px apart, centered at x=500.
    call('_onTouchStart', touchEvent([
      { clientX: 450, clientY: 250 },
      { clientX: 550, clientY: 250 },
    ]));
    // Slide BOTH fingers right by 80px — distance unchanged (no zoom),
    // center moves +80 (pan).
    call('_onTouchMove', touchEvent([
      { clientX: 530, clientY: 250 },
      { clientX: 630, clientY: 250 },
    ]));
    expect(viewport.candleWidth).toBeCloseTo(widthBefore, 5); // no zoom
    expect(Math.abs(viewport.startIndex - startBefore)).toBeGreaterThan(0.01); // panned
  });

  it('two fingers spreading apart zoom in', () => {
    const widthBefore = viewport.candleWidth;
    call('_onTouchStart', touchEvent([
      { clientX: 450, clientY: 250 },
      { clientX: 550, clientY: 250 },
    ]));
    // Spread fingers from 100px to 200px apart, same center → zoom in.
    call('_onTouchMove', touchEvent([
      { clientX: 400, clientY: 250 },
      { clientX: 600, clientY: 250 },
    ]));
    expect(viewport.candleWidth).toBeGreaterThan(widthBefore);
  });

  it('two fingers pinching together zoom out', () => {
    // First zoom in a bit so there's room to zoom back out.
    viewport.zoom(2, 500);
    const widthBefore = viewport.candleWidth;
    call('_onTouchStart', touchEvent([
      { clientX: 400, clientY: 250 },
      { clientX: 600, clientY: 250 },
    ]));
    // Pinch from 200px to 100px → zoom out.
    call('_onTouchMove', touchEvent([
      { clientX: 450, clientY: 250 },
      { clientX: 550, clientY: 250 },
    ]));
    expect(viewport.candleWidth).toBeLessThan(widthBefore);
  });
});
