import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { ReplayController, DEFAULT_BARS_PER_SECOND } from './ReplayController';
import { ChartEngine } from '../rendering/ChartEngine';
import { CandleBuffer } from '../data/CandleBuffer';
import { DARK_THEME } from '../constants';
import { installCanvasStub } from '../test-utils/canvasStub';
import type { Candle } from '../types';

/**
 * Strictly increasing close so a replay cap shrinks the autoscaled price max:
 * with cap k the newest revealed bar is k-1 (high ≈ 101 + (k-1)), strictly
 * below the full-buffer max (high ≈ 101 + (n-1)). Lets us assert the engine's
 * visible/autoscale state honors the cap.
 */
function makeCandle(i: number): Candle {
  const c = 100 + i;
  return { o: c, h: c + 1, l: c - 1, c, v: 10 + i, t: 1_700_000_000 + i * 60 };
}

function fillEngine(engine: ChartEngine, n: number): CandleBuffer {
  const buf = new CandleBuffer();
  for (let i = 0; i < n; i++) buf.append(makeCandle(i));
  engine.setBuffer(buf);
  engine.viewport.scrollToEnd(buf.length);
  return buf;
}

function forceRender(engine: ChartEngine): void {
  (engine as unknown as { _render: () => void })._render();
}

describe('ChartEngine.setReplayCap / _effectiveLength', () => {
  let container: HTMLDivElement;
  let engine: ChartEngine;

  beforeAll(() => installCanvasStub());

  beforeEach(() => {
    container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({ width: 1000, height: 500, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, toJSON() {} }) as DOMRect;
    document.body.appendChild(container);
    engine = new ChartEngine(container, DARK_THEME);
  });

  afterEach(() => {
    engine.destroy();
    container.remove();
  });

  it('defaults to no cap', () => {
    expect(engine.getReplayCap()).toBeNull();
  });

  it('clamps a cap into [1, buffer.length] and floors fractional caps', () => {
    fillEngine(engine, 50);
    engine.setReplayCap(0);
    expect(engine.getReplayCap()).toBe(1);
    engine.setReplayCap(999);
    expect(engine.getReplayCap()).toBe(50);
    engine.setReplayCap(10.9);
    expect(engine.getReplayCap()).toBe(10);
    engine.setReplayCap(-5);
    expect(engine.getReplayCap()).toBe(1);
  });

  it('null clears the cap', () => {
    fillEngine(engine, 50);
    engine.setReplayCap(10);
    expect(engine.getReplayCap()).toBe(10);
    engine.setReplayCap(null);
    expect(engine.getReplayCap()).toBeNull();
  });

  it('an empty buffer cannot be capped (stays null)', () => {
    const buf = new CandleBuffer();
    engine.setBuffer(buf);
    engine.setReplayCap(5);
    expect(engine.getReplayCap()).toBeNull();
  });

  it('a cap shrinks the autoscaled price range to the revealed prefix', () => {
    fillEngine(engine, 100);
    forceRender(engine);
    const fullMax = engine.viewport.priceMax;

    // Reveal only the first 20 bars (newest revealed bar = index 19).
    engine.setReplayCap(20);
    engine.viewport.scrollToEnd(20); // park the capped bar at the live edge
    forceRender(engine);
    const cappedMax = engine.viewport.priceMax;

    expect(cappedMax).toBeLessThan(fullMax);
    // Bar 19 high == 120; with 5% padding priceMax is just above it and well
    // below the full-buffer max (bar 99 high == 200).
    expect(cappedMax).toBeGreaterThanOrEqual(120);
    expect(cappedMax).toBeLessThan(140);
  });

  it('autoscale never scans past the cap when the window would reach further', () => {
    fillEngine(engine, 100);
    // Cap to the first 5 bars, but scroll the viewport back to index 0 so its
    // visible window (≈ the whole chart width) nominally extends FAR past the
    // cap. Autoscale must still stop at the cap and only see bars 0..4.
    engine.setReplayCap(5);
    engine.viewport.startIndex = 0;
    forceRender(engine);
    // Bars 0..4: highs 101..105 → priceMax just above 105, nowhere near the
    // full-buffer max (bar 99 high == 200).
    expect(engine.viewport.priceMax).toBeGreaterThanOrEqual(105);
    expect(engine.viewport.priceMax).toBeLessThan(115);
  });

  it('clearing the cap restores the full autoscale range (bit-for-bit)', () => {
    const buf = fillEngine(engine, 100);
    forceRender(engine);
    const fullMin = engine.viewport.priceMin;
    const fullMax = engine.viewport.priceMax;
    const fullVol = engine.viewport.volumeMax;

    engine.setReplayCap(20);
    engine.viewport.scrollToEnd(20);
    forceRender(engine);

    // Back to full.
    engine.setReplayCap(null);
    engine.viewport.scrollToEnd(buf.length);
    forceRender(engine);
    expect(engine.viewport.priceMin).toBe(fullMin);
    expect(engine.viewport.priceMax).toBe(fullMax);
    expect(engine.viewport.volumeMax).toBe(fullVol);
  });

  it('renders without throwing while capped', () => {
    fillEngine(engine, 100);
    engine.setReplayCap(30);
    expect(() => forceRender(engine)).not.toThrow();
  });
});

describe('ReplayController', () => {
  let container: HTMLDivElement;
  let engine: ChartEngine;
  let buffer: CandleBuffer;

  beforeAll(() => installCanvasStub());

  beforeEach(() => {
    // Make requestRender synchronous so each index change paints immediately.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({ width: 1000, height: 500, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, toJSON() {} }) as DOMRect;
    document.body.appendChild(container);
    engine = new ChartEngine(container, DARK_THEME);
    buffer = fillEngine(engine, 50);
  });

  afterEach(() => {
    engine.destroy();
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('start engages replay at fromIndex and sets the cap', () => {
    const r = new ReplayController(engine, buffer);
    r.start(5);
    expect(r.index).toBe(5);
    expect(r.active).toBe(true);
    expect(r.playing).toBe(false);
    expect(engine.getReplayCap()).toBe(6); // index + 1
    r.destroy();
  });

  it('start defaults fromIndex to 0', () => {
    const r = new ReplayController(engine, buffer);
    r.start();
    expect(r.index).toBe(0);
    expect(engine.getReplayCap()).toBe(1);
    r.destroy();
  });

  it('start clamps fromIndex into range', () => {
    const r = new ReplayController(engine, buffer);
    r.start(999);
    expect(r.index).toBe(49);
    expect(engine.getReplayCap()).toBe(50);
    r.destroy();
  });

  it('step forward advances the index and cap', () => {
    const r = new ReplayController(engine, buffer);
    r.start(0);
    r.step();
    expect(r.index).toBe(1);
    expect(engine.getReplayCap()).toBe(2);
    r.step(true);
    expect(r.index).toBe(2);
    expect(engine.getReplayCap()).toBe(3);
    r.destroy();
  });

  it('step backward retreats but never below 0', () => {
    const r = new ReplayController(engine, buffer);
    r.start(2);
    r.step(false);
    expect(r.index).toBe(1);
    r.step(false);
    r.step(false);
    expect(r.index).toBe(0);
    r.destroy();
  });

  it('onChange fires on start and each step', () => {
    const onChange = vi.fn();
    const r = new ReplayController(engine, buffer, { onChange });
    r.start(0);
    r.step();
    r.step();
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenLastCalledWith(2, false);
    r.destroy();
  });

  it('a forward step onto the last bar auto-pauses', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const r = new ReplayController(engine, buffer);
    r.start(48); // last index is 49
    r.play();
    expect(r.playing).toBe(true);
    vi.advanceTimersByTime(1000 / DEFAULT_BARS_PER_SECOND); // one tick → reveal bar 49
    expect(r.index).toBe(49);
    expect(r.playing).toBe(false); // auto-paused at the newest bar
    r.destroy();
  });

  it('play advances one bar per interval under fake timers', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const r = new ReplayController(engine, buffer);
    r.start(0);
    r.setSpeed(10); // 100ms per bar
    r.play();
    expect(r.playing).toBe(true);

    vi.advanceTimersByTime(100);
    expect(r.index).toBe(1);
    vi.advanceTimersByTime(300); // 3 more ticks
    expect(r.index).toBe(4);
    expect(engine.getReplayCap()).toBe(5);
    r.destroy();
  });

  it('pause stops the timer mid-playback', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const r = new ReplayController(engine, buffer);
    r.start(0);
    r.setSpeed(10);
    r.play();
    vi.advanceTimersByTime(200); // 2 ticks → index 2
    expect(r.index).toBe(2);
    r.pause();
    expect(r.playing).toBe(false);
    vi.advanceTimersByTime(1000); // no further advance after pause
    expect(r.index).toBe(2);
    r.destroy();
  });

  it('play is a no-op at the last bar', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const r = new ReplayController(engine, buffer);
    r.start(49); // already the newest bar
    r.play();
    expect(r.playing).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(r.index).toBe(49);
    r.destroy();
  });

  it('setSpeed changes the interval and takes effect immediately', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const r = new ReplayController(engine, buffer);
    r.start(0);
    r.setSpeed(10); // 100ms/bar
    r.play();
    vi.advanceTimersByTime(100);
    expect(r.index).toBe(1);
    r.setSpeed(20); // 50ms/bar — restarts the timer
    vi.advanceTimersByTime(50);
    expect(r.index).toBe(2);
    vi.advanceTimersByTime(50);
    expect(r.index).toBe(3);
    r.destroy();
  });

  it('setSpeed clamps non-positive / non-finite values', () => {
    const r = new ReplayController(engine, buffer, { barsPerSecond: 5 });
    expect(r.barsPerSecond).toBe(5);
    r.setSpeed(0);
    expect(r.barsPerSecond).toBe(DEFAULT_BARS_PER_SECOND);
    r.setSpeed(Number.NaN);
    expect(r.barsPerSecond).toBe(DEFAULT_BARS_PER_SECOND);
    r.destroy();
  });

  it('seek jumps directly to an index and clamps', () => {
    const r = new ReplayController(engine, buffer);
    r.start(0);
    r.seek(30);
    expect(r.index).toBe(30);
    expect(engine.getReplayCap()).toBe(31);
    r.seek(999);
    expect(r.index).toBe(49);
    r.seek(-10);
    expect(r.index).toBe(0);
    r.destroy();
  });

  it('stop clears the cap and exits replay', () => {
    const r = new ReplayController(engine, buffer);
    r.start(10);
    expect(engine.getReplayCap()).toBe(11);
    r.stop();
    expect(engine.getReplayCap()).toBeNull();
    expect(r.active).toBe(false);
    expect(r.playing).toBe(false);
    r.destroy();
  });

  it('stop while playing also halts the timer', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const r = new ReplayController(engine, buffer);
    r.start(0);
    r.setSpeed(10);
    r.play();
    vi.advanceTimersByTime(100);
    r.stop();
    expect(r.playing).toBe(false);
    const at = r.index;
    vi.advanceTimersByTime(1000);
    expect(r.index).toBe(at); // no ticks after stop
    r.destroy();
  });

  it('destroy stops the timer (no further ticks)', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const r = new ReplayController(engine, buffer);
    r.start(0);
    r.setSpeed(10);
    r.play();
    vi.advanceTimersByTime(100);
    const at = r.index;
    r.destroy();
    vi.advanceTimersByTime(1000);
    expect(r.index).toBe(at);
  });

  it('start/play no-op on an empty buffer', () => {
    const emptyBuf = new CandleBuffer();
    engine.setBuffer(emptyBuf);
    const r = new ReplayController(engine, emptyBuf);
    r.start(0);
    expect(r.active).toBe(false);
    expect(engine.getReplayCap()).toBeNull();
    r.destroy();
  });

  it('the engine reflects the capped last bar in its render state', () => {
    const r = new ReplayController(engine, buffer);
    r.start(0); // only bar 0 revealed (the first/oldest)
    forceRender(engine);
    // Bar 0: low 99, high 101 → autoscaled range collapses around it, far
    // below the full buffer (bar 49 high == 150).
    expect(engine.viewport.priceMax).toBeLessThan(110);
    r.seek(49); // reveal everything
    forceRender(engine);
    expect(engine.viewport.priceMax).toBeGreaterThanOrEqual(150);
    r.destroy();
  });
});
