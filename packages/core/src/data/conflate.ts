import type { CandleView, ChartLayout } from '../types';
import type { Viewport } from '../interaction/Viewport';

/**
 * Pixels-per-candle below which rendering switches to conflation. Above
 * this, candles are at least ~1px apart and the normal per-candle render
 * path runs unchanged. Below it, many candles share a pixel column and we
 * collapse each column to a single aggregated bar.
 */
export const CONFLATE_STEP_THRESHOLD = 1;

/**
 * Downsample (conflate) a candle view to at most one aggregated candle per
 * pixel column, for the "fit the whole multi-million-bar history on screen"
 * case. Returns the input view UNCHANGED when candles are ≥1px apart
 * (`candleStep >= CONFLATE_STEP_THRESHOLD`) or the view is empty — so the
 * normal render path is byte-for-byte preserved and conflation is pure
 * opt-in by zoom level.
 *
 * Per-column aggregation (OHLC semantics):
 *   open   = first candle's open
 *   close  = last candle's close
 *   high   = max high (NaN inputs ignored on merge)
 *   low    = min low  (NaN inputs ignored on merge)
 *   volume = sum of finite volumes
 *   time   = first candle's time
 *
 * Each output bucket carries `repIndex` = the buffer index of its first
 * candle, so renderers position it via `viewport.indexToX(repIndex[k])`
 * and keep using the existing uniform-step geometry. Crosshair/hit-test
 * stay on raw indices (conflation is render-only).
 */
export function conflate(view: CandleView, viewport: Viewport, layout: ChartLayout): CandleView {
  if (view.length === 0 || viewport.candleStep >= CONFLATE_STEP_THRESHOLD) {
    return view;
  }

  // One bucket per pixel column of chart width, plus slack for candles that
  // spill a few pixels past either edge.
  const chartWidth = layout.chartRight - layout.chartLeft;
  const maxBuckets = Math.max(1, Math.ceil(chartWidth) + 4);

  const open = new Float64Array(maxBuckets);
  const high = new Float64Array(maxBuckets);
  const low = new Float64Array(maxBuckets);
  const close = new Float64Array(maxBuckets);
  const volume = new Float64Array(maxBuckets);
  const time = new Float64Array(maxBuckets);
  const repIndex = new Int32Array(maxBuckets);

  let k = -1;
  let curCol = Number.NaN;

  for (let i = 0; i < view.length; i++) {
    const bufferIndex = view.offset + i;
    const col = Math.floor(viewport.indexToX(bufferIndex));
    const o = view.open[i]!;
    const h = view.high[i]!;
    const l = view.low[i]!;
    const c = view.close[i]!;
    const v = view.volume[i]!;

    // Start a new bucket on a column change, unless we've exhausted the
    // allocation — then keep merging into the final bucket so we never
    // write out of bounds.
    if (col !== curCol && k + 1 < maxBuckets) {
      k++;
      curCol = col;
      open[k] = o;
      high[k] = h;
      low[k] = l;
      close[k] = c;
      volume[k] = Number.isFinite(v) ? v : 0;
      time[k] = view.time[i]!;
      repIndex[k] = bufferIndex;
      continue;
    }

    // Merge into the current bucket. `>`/`<` with NaN is false, so NaN
    // inputs are simply ignored on merge (the first candle seeds the bucket).
    if (h > high[k]!) high[k] = h;
    if (l < low[k]!) low[k] = l;
    close[k] = c; // last close wins
    if (Number.isFinite(v)) volume[k] = volume[k]! + v;
  }

  const length = k + 1;
  return {
    open: open.subarray(0, length),
    high: high.subarray(0, length),
    low: low.subarray(0, length),
    close: close.subarray(0, length),
    volume: volume.subarray(0, length),
    time: time.subarray(0, length),
    length,
    offset: view.offset,
    repIndex: repIndex.subarray(0, length),
  };
}
