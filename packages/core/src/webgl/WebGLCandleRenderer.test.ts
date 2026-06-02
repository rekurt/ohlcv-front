import { describe, it, expect, vi } from 'vitest';
import { WebGLCandleRenderer } from './WebGLCandleRenderer';
import type { Viewport } from '../interaction/Viewport';
import type { CandleView, ChartLayout, ThemeColors } from '../types';

// --- mock WebGL context ---------------------------------------------------

/** GL enum constants the renderer references. Arbitrary distinct numbers. */
const GL_CONST = {
  VERTEX_SHADER: 0x8b31,
  FRAGMENT_SHADER: 0x8b30,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  ARRAY_BUFFER: 0x8892,
  STATIC_DRAW: 0x88e4,
  DYNAMIC_DRAW: 0x88e8,
  TRIANGLES: 0x0004,
  FLOAT: 0x1406,
  COLOR_BUFFER_BIT: 0x4000,
};

interface MockGL extends Record<string, unknown> {
  __calls: Record<string, unknown[][]>;
}

/**
 * A recording WebGL stub. Every method pushes its args into `__calls[name]`;
 * the few methods that must return a value are stubbed to satisfy the
 * renderer's success path (shaders compile, program links, locations resolve).
 * `failCompile` / `failLink` flip the relevant parameter query to false to
 * exercise the degrade-gracefully branches.
 */
function makeMockGL(opts?: { failCompile?: boolean; failLink?: boolean }): MockGL {
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return undefined;
    };

  const gl: MockGL = {
    __calls: calls,
    ...GL_CONST,
    createShader: vi.fn((..._a: unknown[]) => {
      (calls.createShader ??= []).push(_a);
      return {};
    }),
    shaderSource: record('shaderSource'),
    compileShader: record('compileShader'),
    getShaderParameter: vi.fn((..._a: unknown[]) => {
      (calls.getShaderParameter ??= []).push(_a);
      return !opts?.failCompile;
    }),
    getShaderInfoLog: vi.fn(() => ''),
    createProgram: vi.fn((..._a: unknown[]) => {
      (calls.createProgram ??= []).push(_a);
      return {};
    }),
    attachShader: record('attachShader'),
    linkProgram: record('linkProgram'),
    getProgramParameter: vi.fn((..._a: unknown[]) => {
      (calls.getProgramParameter ??= []).push(_a);
      return !opts?.failLink;
    }),
    getProgramInfoLog: vi.fn(() => ''),
    createBuffer: vi.fn((..._a: unknown[]) => {
      (calls.createBuffer ??= []).push(_a);
      return {};
    }),
    bindBuffer: record('bindBuffer'),
    bufferData: record('bufferData'),
    useProgram: record('useProgram'),
    getAttribLocation: vi.fn((..._a: unknown[]) => {
      (calls.getAttribLocation ??= []).push(_a);
      return 0;
    }),
    getUniformLocation: vi.fn((..._a: unknown[]) => {
      (calls.getUniformLocation ??= []).push(_a);
      return {};
    }),
    enableVertexAttribArray: record('enableVertexAttribArray'),
    vertexAttribPointer: record('vertexAttribPointer'),
    uniform2f: record('uniform2f'),
    drawArrays: record('drawArrays'),
    viewport: record('viewport'),
    clearColor: record('clearColor'),
    clear: record('clear'),
    deleteBuffer: record('deleteBuffer'),
    deleteProgram: record('deleteProgram'),
    deleteShader: record('deleteShader'),
  };
  return gl;
}

/** A canvas whose `getContext('webgl')` returns `gl` (or null). */
function makeCanvas(gl: MockGL | null, width = 800, height = 600): HTMLCanvasElement {
  return {
    width,
    height,
    getContext: (type: string) => (type === 'webgl' ? gl : null),
  } as unknown as HTMLCanvasElement;
}

// --- scene doubles --------------------------------------------------------

const THEME: ThemeColors = {
  background: '#000000',
  bullCandle: '#26a69a',
  bearCandle: '#ef5350',
  bullVolume: 'rgba(38,166,154,0.3)',
  bearVolume: 'rgba(239,83,80,0.3)',
  grid: '#1e222d',
  axis: '#363a45',
  text: '#d1d4dc',
  crosshair: '#758696',
  priceLine: '#4c525e',
};

function makeViewport(): Viewport {
  return {
    candleWidth: 10,
    candleStep: 14,
    indexToX: (index: number) => index * 14,
    priceToY: (p: number) => 500 - p,
  } as unknown as Viewport;
}

function makeLayout(): ChartLayout {
  return {
    width: 800,
    height: 600,
    chartTop: 0,
    chartBottom: 500,
    chartLeft: 0,
    chartRight: 800,
    volumeTop: 400,
    volumeBottom: 500,
    priceAxisWidth: 80,
    leftAxisWidth: 0,
    timeAxisHeight: 30,
    paneAreaTop: 500,
    paneAreaBottom: 570,
    paneCount: 0,
  };
}

function makeView(n: number): CandleView {
  const open = new Float64Array(n);
  const high = new Float64Array(n);
  const low = new Float64Array(n);
  const close = new Float64Array(n);
  const volume = new Float64Array(n);
  const time = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    open[i] = 10 + (i % 3);
    high[i] = 20;
    low[i] = 5;
    close[i] = 12 + (i % 2);
    volume[i] = 1;
    time[i] = i;
  }
  return { open, high, low, close, volume, time, length: n, offset: 0 };
}

// --- tests ----------------------------------------------------------------

describe('WebGLCandleRenderer', () => {
  it('compiles two shaders and links one program in the constructor', () => {
    const gl = makeMockGL();
    const renderer = new WebGLCandleRenderer(makeCanvas(gl));
    expect(renderer.supported).toBe(true);
    expect(gl.__calls.compileShader?.length).toBe(2);
    expect(gl.__calls.linkProgram?.length).toBe(1);
    // Both shader types were sourced.
    const types = (gl.__calls.createShader ?? []).map((a) => a[0]);
    expect(types).toContain(GL_CONST.VERTEX_SHADER);
    expect(types).toContain(GL_CONST.FRAGMENT_SHADER);
    // Buffers + attribute/uniform locations were resolved.
    expect(gl.__calls.createBuffer?.length).toBe(2);
    expect(gl.__calls.getAttribLocation?.length).toBe(2);
    expect(gl.__calls.getUniformLocation?.length).toBe(1);
  });

  it('render uploads buffers and draws the expected vertex count', () => {
    const gl = makeMockGL();
    const renderer = new WebGLCandleRenderer(makeCanvas(gl));
    const n = 5;
    renderer.render(makeView(n), makeViewport(), makeLayout(), THEME);

    // Two bufferData uploads (positions + colors).
    expect(gl.__calls.bufferData?.length).toBeGreaterThanOrEqual(2);
    // Both upload with DYNAMIC_DRAW (geometry changes every frame).
    for (const args of gl.__calls.bufferData ?? []) {
      expect(args[2]).toBe(GL_CONST.DYNAMIC_DRAW);
    }
    // One draw call for the whole frame, with vertexCount = visible*12.
    expect(gl.__calls.drawArrays?.length).toBe(1);
    const draw = gl.__calls.drawArrays![0]!;
    expect(draw[0]).toBe(GL_CONST.TRIANGLES);
    expect(draw[1]).toBe(0);
    expect(draw[2]).toBe(n * 12);

    // Viewport + resolution uniform were set to the canvas size.
    expect(gl.__calls.viewport?.[0]).toEqual([0, 0, 800, 600]);
    expect(gl.__calls.uniform2f?.[0]?.slice(1)).toEqual([800, 600]);
  });

  it('render clears but issues no draw call when nothing is visible', () => {
    const gl = makeMockGL();
    const renderer = new WebGLCandleRenderer(makeCanvas(gl));
    renderer.render(makeView(0), makeViewport(), makeLayout(), THEME);
    expect(gl.__calls.clear?.length).toBe(1);
    expect(gl.__calls.drawArrays).toBeUndefined();
  });

  it('resize updates the viewport/resolution used by the next render', () => {
    const gl = makeMockGL();
    const renderer = new WebGLCandleRenderer(makeCanvas(gl, 800, 600));
    renderer.resize(1024, 768);
    renderer.render(makeView(2), makeViewport(), makeLayout(), THEME);
    expect(gl.__calls.viewport?.[0]).toEqual([0, 0, 1024, 768]);
    expect(gl.__calls.uniform2f?.[0]?.slice(1)).toEqual([1024, 768]);
  });

  it('sets supported=false without throwing when getContext returns null', () => {
    const renderer = new WebGLCandleRenderer(makeCanvas(null));
    expect(renderer.supported).toBe(false);
    // All ops are safe no-ops.
    expect(() => {
      renderer.resize(100, 100);
      renderer.render(makeView(3), makeViewport(), makeLayout(), THEME);
      renderer.dispose();
    }).not.toThrow();
  });

  it('degrades gracefully (supported=false) on a shader compile failure', () => {
    const gl = makeMockGL({ failCompile: true });
    const renderer = new WebGLCandleRenderer(makeCanvas(gl));
    expect(renderer.supported).toBe(false);
    // Cleanup of the failed shader was attempted; no program was created.
    expect(gl.__calls.deleteShader?.length).toBeGreaterThanOrEqual(1);
    expect(gl.__calls.createProgram).toBeUndefined();
  });

  it('degrades gracefully (supported=false) on a program link failure', () => {
    const gl = makeMockGL({ failLink: true });
    const renderer = new WebGLCandleRenderer(makeCanvas(gl));
    expect(renderer.supported).toBe(false);
    expect(gl.__calls.deleteProgram?.length).toBeGreaterThanOrEqual(1);
  });

  it('render is a no-op after a failed init (no draw)', () => {
    const gl = makeMockGL({ failLink: true });
    const renderer = new WebGLCandleRenderer(makeCanvas(gl));
    renderer.render(makeView(4), makeViewport(), makeLayout(), THEME);
    expect(gl.__calls.drawArrays).toBeUndefined();
  });

  it('dispose deletes buffers, program and shaders and flips supported off', () => {
    const gl = makeMockGL();
    const renderer = new WebGLCandleRenderer(makeCanvas(gl));
    expect(renderer.supported).toBe(true);
    renderer.dispose();
    expect(gl.__calls.deleteBuffer?.length).toBe(2);
    expect(gl.__calls.deleteProgram?.length).toBe(1);
    expect(gl.__calls.deleteShader?.length).toBe(2);
    expect(renderer.supported).toBe(false);
    // Idempotent: a second dispose does nothing more / does not throw.
    renderer.dispose();
    expect(gl.__calls.deleteBuffer?.length).toBe(2);
  });
});
