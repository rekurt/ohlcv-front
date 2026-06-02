import type { ThemeColors, ChartLayout, CandleView } from '../types';
import type { Viewport } from '../interaction/Viewport';
import { buildCandleVertices } from './candleGeometry';

/**
 * Vertex shader: takes pixel-space positions (`a_position`) and per-vertex RGB
 * (`a_color`), converts pixels → clip space using the canvas resolution
 * (`u_resolution`), and forwards the color. Y is flipped because pixel space
 * grows downward while clip space grows upward.
 */
const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
attribute vec3 a_color;
uniform vec2 u_resolution;
varying vec3 v_color;
void main() {
  vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_color = a_color;
}
`;

/** Fragment shader: flat-shade each triangle with the interpolated vertex color. */
const FRAGMENT_SHADER_SOURCE = `
precision mediump float;
varying vec3 v_color;
void main() {
  gl_FragColor = vec4(v_color, 1.0);
}
`;

/**
 * OPTIONAL GPU-instanced renderer for the candle hot path. Draws ONLY the
 * candle bodies + wicks via WebGL `TRIANGLES`; axes, grid, legend, crosshair,
 * and everything else stay on Canvas2D. It is **not** wired into
 * `ChartEngine`/`OHLCVChart` — a host opts in explicitly, layering a WebGL
 * canvas under the existing 2D layers, so this whole module tree-shakes to
 * zero in the base bundle.
 *
 * The expensive geometry step ({@link buildCandleVertices}) is a pure function
 * with no GL/DOM dependency, so it is fully unit-testable; this class is the
 * thin GL wrapper around it.
 *
 * Graceful degradation: if the browser can't give a `webgl` context (very old
 * browser, blocked GPU) the constructor sets {@link supported} to `false` and
 * never throws — a host checks the flag and falls back to the Canvas2D path.
 *
 * @example
 * ```ts
 * const gl = new WebGLCandleRenderer(glCanvas);
 * if (gl.supported) {
 *   gl.resize(layout.width, layout.height);
 *   gl.render(view, viewport, layout, theme); // each frame
 * } else {
 *   // fall back to the Canvas2D CandleRenderer
 * }
 * // on teardown
 * gl.dispose();
 * ```
 */
export class WebGLCandleRenderer {
  /**
   * `true` when a WebGL context was acquired and the shader program linked.
   * When `false`, {@link render}/{@link resize}/{@link dispose} are all safe
   * no-ops and the host should use the Canvas2D candle path instead.
   */
  supported = false;

  private _gl: WebGLRenderingContext | null = null;
  private _program: WebGLProgram | null = null;
  private _vertexShader: WebGLShader | null = null;
  private _fragmentShader: WebGLShader | null = null;
  private _positionBuffer: WebGLBuffer | null = null;
  private _colorBuffer: WebGLBuffer | null = null;
  private _positionLoc = -1;
  private _colorLoc = -1;
  private _resolutionLoc: WebGLUniformLocation | null = null;
  private _width = 0;
  private _height = 0;
  private readonly _canvas: HTMLCanvasElement;
  private readonly _onContextLost: (e: Event) => void;
  private readonly _onContextRestored: () => void;

  /**
   * @param canvas The canvas to render candles into. Should be sized/stacked by
   *   the host beneath the chart's existing 2D layers. If `getContext('webgl')`
   *   returns null the renderer disables itself ({@link supported} stays false).
   */
  constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas;
    // Handle GPU context loss (tab throttle, GPU switch, driver reset): after a
    // loss every GL object is invalid. Disable so the host falls back to
    // Canvas2D; rebuild from scratch if/when the context is restored. Without
    // this a long-lived chart would silently render nothing forever.
    this._onContextLost = (e: Event) => {
      e.preventDefault(); // required, or the context never fires 'restored'
      this.supported = false;
    };
    this._onContextRestored = () => {
      if (this._gl) this._initGL(this._gl);
    };
    canvas.addEventListener('webglcontextlost', this._onContextLost);
    canvas.addEventListener('webglcontextrestored', this._onContextRestored);

    const gl = canvas.getContext('webgl');
    if (!gl) {
      // No WebGL — degrade gracefully. The host falls back to Canvas2D.
      return;
    }
    this._initGL(gl);
  }

  /**
   * (Re)build the GL program/shaders/buffers on the given context. Called from
   * the constructor and from `webglcontextrestored` (after a loss all prior GL
   * objects are gone). Leaves {@link supported} false on any compile/link
   * failure so the host falls back.
   */
  private _initGL(gl: WebGLRenderingContext): void {
    this._gl = gl;
    this._width = this._canvas.width || this._width;
    this._height = this._canvas.height || this._height;

    const vs = this._compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fs = this._compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
    if (!vs || !fs) return;
    this._vertexShader = vs;
    this._fragmentShader = fs;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      // Link failure — leave supported=false so the host falls back.
      gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      return;
    }
    this._program = program;

    this._positionLoc = gl.getAttribLocation(program, 'a_position');
    this._colorLoc = gl.getAttribLocation(program, 'a_color');
    this._resolutionLoc = gl.getUniformLocation(program, 'u_resolution');
    this._positionBuffer = gl.createBuffer();
    this._colorBuffer = gl.createBuffer();

    this.supported = true;
  }

  /** Compile one shader; returns null (and cleans up) on a compile error. */
  private _compileShader(
    gl: WebGLRenderingContext,
    type: number,
    source: string,
  ): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  /**
   * Update the cached drawable size (pixels). Call after the host resizes the
   * GL canvas so the next {@link render} uses the right `gl.viewport` and
   * pixel→clip resolution. No-op when unsupported.
   */
  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
  }

  /**
   * Build candle geometry for `view` and draw it. Uploads fresh positions/colors
   * (`DYNAMIC_DRAW` — they change every frame), sets the viewport + resolution
   * uniform, optionally clears, then issues one `drawArrays(TRIANGLES, …)` for
   * the whole frame. No-op when unsupported or when there are zero visible
   * vertices.
   */
  render(view: CandleView, viewport: Viewport, layout: ChartLayout, theme: ThemeColors): void {
    const gl = this._gl;
    if (!gl || !this._program) return;
    // Context lost between frames — disable so the host falls back. The
    // 'webglcontextrestored' handler re-inits if/when the GPU returns.
    if (gl.isContextLost()) {
      this.supported = false;
      return;
    }

    const { positions, colors, vertexCount } = buildCandleVertices(view, viewport, layout, theme);

    gl.viewport(0, 0, this._width, this._height);
    // Transparent clear so the WebGL layer composites over the 2D layers below.
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (vertexCount === 0) return;

    gl.useProgram(this._program);
    gl.uniform2f(this._resolutionLoc, this._width, this._height);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this._positionLoc);
    gl.vertexAttribPointer(this._positionLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this._colorLoc);
    gl.vertexAttribPointer(this._colorLoc, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
  }

  /**
   * Release every GL resource (buffers, program, shaders). Idempotent and safe
   * when unsupported. After this the renderer must not be used again.
   */
  dispose(): void {
    this._canvas.removeEventListener('webglcontextlost', this._onContextLost);
    this._canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
    const gl = this._gl;
    if (!gl) return;
    if (this._positionBuffer) gl.deleteBuffer(this._positionBuffer);
    if (this._colorBuffer) gl.deleteBuffer(this._colorBuffer);
    if (this._program) gl.deleteProgram(this._program);
    if (this._vertexShader) gl.deleteShader(this._vertexShader);
    if (this._fragmentShader) gl.deleteShader(this._fragmentShader);
    this._positionBuffer = null;
    this._colorBuffer = null;
    this._program = null;
    this._vertexShader = null;
    this._fragmentShader = null;
    this._gl = null;
    this.supported = false;
  }
}
