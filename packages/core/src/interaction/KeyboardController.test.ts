import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyboardController } from './KeyboardController';
import { Viewport } from './Viewport';
import { CandleBuffer } from '../data/CandleBuffer';
import { computeLayout } from '../utils';
import type { Candle } from '../types';

function makeBuffer(n: number): CandleBuffer {
  const buf = new CandleBuffer();
  for (let i = 0; i < n; i++) {
    const c: Candle = {
      o: 100 + i * 0.1,
      h: 100.5 + i * 0.1,
      l: 99.5 + i * 0.1,
      c: 100.2 + i * 0.1,
      v: 1000,
      t: 1_700_000_000 + i * 60,
    };
    buf.append(c);
  }
  return buf;
}

function dispatch(el: HTMLElement, key: string, modifiers: KeyboardEventInit = {}): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }));
}

describe('KeyboardController', () => {
  let el: HTMLElement;
  let viewport: Viewport;
  let buffer: CandleBuffer;
  let onViewportChange: ReturnType<typeof vi.fn>;
  let onGoToLive: ReturnType<typeof vi.fn>;
  let onFitVisible: ReturnType<typeof vi.fn>;
  let onFitAll: ReturnType<typeof vi.fn>;
  let controller: KeyboardController;

  beforeEach(() => {
    el = document.createElement('div');
    el.tabIndex = 0;
    document.body.appendChild(el);

    viewport = new Viewport();
    viewport.setLayout(computeLayout(1000, 500));
    buffer = makeBuffer(500);
    viewport.scrollToEnd(buffer.length);

    onViewportChange = vi.fn();
    onGoToLive = vi.fn();
    onFitVisible = vi.fn();
    onFitAll = vi.fn();

    controller = new KeyboardController(el, viewport, buffer, {
      onViewportChange,
      onGoToLive,
      onFitVisible,
      onFitAll,
    });
  });

  afterEach(() => {
    controller.destroy();
    el.remove();
  });

  it('ArrowLeft pans backwards by 5 candles', () => {
    const before = viewport.startIndex;
    dispatch(el, 'ArrowLeft');
    expect(viewport.startIndex).toBeCloseTo(before - 5);
    expect(onViewportChange).toHaveBeenCalledOnce();
  });

  it('ArrowRight pans forwards by 5 candles', () => {
    viewport.pan(-50); // pull back so forward pan has room
    const before = viewport.startIndex;
    dispatch(el, 'ArrowRight');
    expect(viewport.startIndex).toBeCloseTo(before + 5);
  });

  it('Shift+ArrowLeft uses the fast step (25)', () => {
    const before = viewport.startIndex;
    dispatch(el, 'ArrowLeft', { shiftKey: true });
    expect(viewport.startIndex).toBeCloseTo(before - 25);
  });

  it('Shift+ArrowRight uses the fast step (25)', () => {
    viewport.pan(-50);
    const before = viewport.startIndex;
    dispatch(el, 'ArrowRight', { shiftKey: true });
    expect(viewport.startIndex).toBeCloseTo(before + 25);
  });

  it('+ zooms in (candleWidth increases)', () => {
    const before = viewport.candleWidth;
    dispatch(el, '+');
    expect(viewport.candleWidth).toBeGreaterThan(before);
  });

  it('= also zooms in (unshifted + key on many layouts)', () => {
    const before = viewport.candleWidth;
    dispatch(el, '=');
    expect(viewport.candleWidth).toBeGreaterThan(before);
  });

  it('- zooms out', () => {
    viewport.candleWidth = 20;
    viewport.setLayout(viewport.layout); // recompute visibleCount
    const before = viewport.candleWidth;
    dispatch(el, '-');
    expect(viewport.candleWidth).toBeLessThan(before);
  });

  it('ArrowUp zooms in', () => {
    const before = viewport.candleWidth;
    dispatch(el, 'ArrowUp');
    expect(viewport.candleWidth).toBeGreaterThan(before);
  });

  it('ArrowDown zooms out', () => {
    viewport.candleWidth = 20;
    viewport.setLayout(viewport.layout);
    const before = viewport.candleWidth;
    dispatch(el, 'ArrowDown');
    expect(viewport.candleWidth).toBeLessThan(before);
  });

  it('Home jumps to startIndex=0 and clears autoFollow', () => {
    dispatch(el, 'Home');
    expect(viewport.startIndex).toBe(0);
    expect(viewport.autoFollow).toBe(false);
  });

  it('End invokes onGoToLive callback', () => {
    dispatch(el, 'End');
    expect(onGoToLive).toHaveBeenCalledOnce();
  });

  it('0 invokes onFitVisible callback', () => {
    dispatch(el, '0');
    expect(onFitVisible).toHaveBeenCalledOnce();
  });

  it('F invokes onFitAll callback', () => {
    dispatch(el, 'F');
    expect(onFitAll).toHaveBeenCalledOnce();
  });

  it('f (lowercase) also invokes onFitAll callback', () => {
    dispatch(el, 'f');
    expect(onFitAll).toHaveBeenCalledOnce();
  });

  it('ignores unrelated keys', () => {
    dispatch(el, 'Escape');
    dispatch(el, 'a');
    dispatch(el, 'Enter');
    expect(onViewportChange).not.toHaveBeenCalled();
    expect(onGoToLive).not.toHaveBeenCalled();
    expect(onFitAll).not.toHaveBeenCalled();
  });

  it('calls preventDefault on handled keys', () => {
    const ev = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('destroy() removes the keydown listener', () => {
    controller.destroy();
    const before = viewport.startIndex;
    dispatch(el, 'ArrowLeft');
    expect(viewport.startIndex).toBe(before);
    expect(onViewportChange).not.toHaveBeenCalled();
  });
});

// Imported late because vitest reads the whole file synchronously
import { afterEach } from 'vitest';
