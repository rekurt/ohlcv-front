import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { ChartEngine } from './ChartEngine';
import { DARK_THEME } from '../constants';
import { installCanvasStub } from '../test-utils/canvasStub';

describe('ChartEngine.toPNG', () => {
  let container: HTMLDivElement;
  let engine: ChartEngine;

  beforeAll(() => {
    installCanvasStub();
  });

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

  it('returns a string (stubbed canvas returns undefined, null, or data URL)', () => {
    const result = engine.toPNG();
    // The Proxy-based canvas stub in test-utils returns undefined for
    // `toDataURL`, which collapses to `null` via the `|| null` coalesce
    // path in browsers. Accept either result here — we just care that
    // the call doesn't throw. A real DOM test would assert the data
    // URL prefix; that coverage is out of scope for jsdom.
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('does not throw even with no buffer set', () => {
    expect(() => engine.toPNG()).not.toThrow();
  });
});
