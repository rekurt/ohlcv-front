import type { ChartEngine } from '../rendering/ChartEngine';
import type { CandleBuffer } from '../data/CandleBuffer';

/**
 * Options for {@link ReplayController}.
 */
export interface ReplayOptions {
  /**
   * Invoked after every index change (start / step / seek / play tick / stop)
   * with the new virtual-end index and whether playback is currently running.
   * On `stop()` the reported index is the last replayed one and `playing` is
   * `false`. Hosts use this to drive a scrubber / play-pause button.
   */
  onChange?: (index: number, playing: boolean) => void;
  /**
   * Playback speed in bars revealed per second. Drives the `play()` timer
   * interval (`1000 / barsPerSecond`). Defaults to {@link DEFAULT_BARS_PER_SECOND}.
   * Clamped to a sane positive range on construction and in {@link setSpeed}.
   */
  barsPerSecond?: number;
}

/** Default playback speed (bars revealed per second) when none is supplied. */
export const DEFAULT_BARS_PER_SECOND = 10;
/** Lower/upper guards so an interval can never be 0ms or absurdly slow. */
const MIN_BARS_PER_SECOND = 0.1;
const MAX_BARS_PER_SECOND = 240;

/**
 * Bar-by-bar history playback (C1, "Replay mode"). Drives the engine's
 * {@link ChartEngine.setReplayCap | replay cap} so the chart reveals candles
 * progressively from some start index up to the live edge.
 *
 * Replay is strictly opt-in: until {@link start} is called the controller
 * touches nothing, and {@link stop} clears the cap so the chart renders the
 * full buffer exactly as before. The controller owns a single timer (started
 * by {@link play}, stopped by {@link pause}/{@link stop}/{@link destroy}); the
 * timer reveals one bar per tick and auto-pauses once the newest bar is shown.
 *
 * The controller positions the viewport so the just-revealed bar sits at the
 * live edge (it scrolls to `index + 1`, treating the revealed prefix as the
 * whole buffer), so playback visually tracks the revealing candle the same way
 * the live feed tracks new appends.
 */
export class ReplayController {
  private _engine: ChartEngine;
  private _buffer: CandleBuffer;
  private _onChange?: (index: number, playing: boolean) => void;

  /** Index of the last currently-revealed bar (the virtual buffer end − 1). */
  private _index = 0;
  private _playing = false;
  private _barsPerSecond: number;
  /** Active `setInterval` handle while playing, or `null`. */
  private _timer: ReturnType<typeof setInterval> | null = null;
  /** True once replay has been started (a cap is/was active). */
  private _active = false;
  private _destroyed = false;

  constructor(engine: ChartEngine, buffer: CandleBuffer, opts?: ReplayOptions) {
    this._engine = engine;
    this._buffer = buffer;
    this._onChange = opts?.onChange;
    this._barsPerSecond = clampSpeed(opts?.barsPerSecond ?? DEFAULT_BARS_PER_SECOND);
  }

  /** Index of the last revealed bar (the virtual buffer end minus one). */
  get index(): number {
    return this._index;
  }

  /** True while the playback timer is running. */
  get playing(): boolean {
    return this._playing;
  }

  /** True once {@link start} has run and replay is engaged (cap active). */
  get active(): boolean {
    return this._active;
  }

  /** Current playback speed in bars per second. */
  get barsPerSecond(): number {
    return this._barsPerSecond;
  }

  /**
   * Enter replay mode and reveal up to (and including) `fromIndex` — default
   * `0`, i.e. start from the very first bar. Clamps `fromIndex` into
   * `[0, length - 1]`. No-op on an empty buffer. Does not start playback;
   * call {@link play} (or {@link step}) to advance. Re-calling `start` while
   * already playing stops the timer first.
   */
  start(fromIndex = 0): void {
    if (this._destroyed) return;
    const len = this._buffer.length;
    if (len <= 0) return;
    this._stopTimer();
    this._playing = false;
    this._active = true;
    this._index = clampIndex(fromIndex, len);
    this._applyCap();
  }

  /**
   * Begin (or resume) automatic playback. No-op when not started, already
   * playing, or already at the last bar. Reveals one bar every
   * `1000 / barsPerSecond` ms and auto-pauses on reaching the newest bar.
   */
  play(): void {
    if (this._destroyed || !this._active || this._playing) return;
    // Nothing left to reveal — don't spin a timer that would immediately pause.
    if (this._index >= this._buffer.length - 1) return;
    this._playing = true;
    this._startTimer();
    // Surface the playing=true transition immediately (the first tick is one
    // interval away), so a host's play/pause button flips without a delay.
    this._onChange?.(this._index, this._playing);
  }

  /** Pause automatic playback. Keeps the current cap/index. No-op if not playing. */
  pause(): void {
    if (!this._playing) return;
    this._playing = false;
    this._stopTimer();
    this._onChange?.(this._index, this._playing);
  }

  /**
   * Reveal/hide one bar. `forward` (default true) advances toward the live
   * edge; `false` steps back toward the start. Clamps at both ends. Auto-
   * pauses if a forward step reaches the newest bar. Stepping while not yet
   * started implicitly engages replay at the resulting index.
   */
  step(forward = true): void {
    if (this._destroyed) return;
    const len = this._buffer.length;
    if (len <= 0) return;
    // A step before start() engages replay (so a host can wire prev/next
    // buttons without an explicit start()).
    this._active = true;
    const next = clampIndex(this._index + (forward ? 1 : -1), len);
    if (next === this._index) {
      // Already at the boundary: if we were playing forward into the end,
      // auto-pause so the timer doesn't keep firing no-op ticks.
      if (forward && this._playing) this.pause();
      return;
    }
    this._index = next;
    this._applyCap();
    // Reached the newest bar while playing → stop the timer (and emit the
    // paused transition) after applying the final cap.
    if (forward && this._playing && this._index >= len - 1) {
      this.pause();
    }
  }

  /**
   * Jump directly to `index` (clamps into `[0, length - 1]`). Engages replay
   * if not already active. Does not change the playing state, except that
   * seeking to the last bar while playing auto-pauses.
   */
  seek(index: number): void {
    if (this._destroyed) return;
    const len = this._buffer.length;
    if (len <= 0) return;
    this._active = true;
    const next = clampIndex(index, len);
    if (next === this._index) return;
    this._index = next;
    this._applyCap();
    if (this._playing && this._index >= len - 1) this.pause();
  }

  /**
   * Change playback speed (bars per second), clamped to a sane positive range.
   * Restarts the running timer with the new interval so a speed change takes
   * effect immediately mid-playback.
   */
  setSpeed(barsPerSecond: number): void {
    this._barsPerSecond = clampSpeed(barsPerSecond);
    if (this._playing) {
      this._stopTimer();
      this._startTimer();
    }
  }

  /**
   * Leave replay mode entirely: stop the timer, clear the engine's replay cap
   * (so the full buffer renders again), and repaint. Emits one final
   * `onChange(index, false)` so a host can reset its UI. Idempotent-ish —
   * safe to call when not started.
   */
  stop(): void {
    // Guard against use-after-destroy: a host that calls stopReplay() after
    // destroy() must not touch the (torn-down) engine.
    if (this._destroyed) return;
    this._stopTimer();
    this._playing = false;
    this._active = false;
    this._engine.setReplayCap(null);
    this._engine.requestRender();
    this._onChange?.(this._index, this._playing);
  }

  /** Stop the timer and release the controller. Does not clear the engine cap. */
  destroy(): void {
    this._destroyed = true;
    this._stopTimer();
    this._playing = false;
  }

  /**
   * Push the current index to the engine as a cap (`index + 1` candles
   * revealed), scroll so the revealed bar sits at the live edge, repaint, and
   * notify. Shared by start/step/seek and the play timer.
   */
  private _applyCap(): void {
    const end = this._index + 1;
    this._engine.setReplayCap(end);
    // Anchor the view on the just-revealed bar: treat the revealed prefix as
    // the whole buffer so scrollToEnd parks the capped bar at the live edge,
    // mirroring how live appends track the newest candle.
    this._engine.viewport.scrollToEnd(end);
    this._engine.requestRender();
    this._onChange?.(this._index, this._playing);
  }

  private _startTimer(): void {
    const interval = 1000 / this._barsPerSecond;
    this._timer = setInterval(() => {
      // step() advances and will auto-pause (clearing the timer) at the end.
      this.step(true);
    }, interval);
  }

  private _stopTimer(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

/** Clamp a bar index into `[0, length - 1]`. */
function clampIndex(index: number, length: number): number {
  const max = length - 1;
  if (!Number.isFinite(index)) return 0;
  const i = Math.floor(index);
  if (i < 0) return 0;
  if (i > max) return max;
  return i;
}

/** Clamp a bars-per-second value into the supported playback range. */
function clampSpeed(bps: number): number {
  if (!Number.isFinite(bps) || bps <= 0) return DEFAULT_BARS_PER_SECOND;
  return Math.max(MIN_BARS_PER_SECOND, Math.min(MAX_BARS_PER_SECOND, bps));
}
