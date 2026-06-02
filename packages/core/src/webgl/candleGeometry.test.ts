import { describe, it, expect } from 'vitest';
import { buildCandleVertices } from './candleGeometry';
import { WICK_WIDTH, MIN_CANDLE_BODY_HEIGHT } from '../constants';
import type { Viewport } from '../interaction/Viewport';
import type { CandleView, ChartLayout, ThemeColors } from '../types';

// --- test doubles ---------------------------------------------------------

/**
 * Minimal Viewport stand-in exposing only what {@link buildCandleVertices}
 * touches: `indexToX`, `priceToY`, `candleWidth`, `candleStep`. Kept as simple
 * linear functions so expected pixel positions are trivial to compute by hand:
 *   X = chartLeft + index * step
 *   Y = price (identity) — a higher price maps to a larger Y here, which is
 *       fine for the geometry assertions (we only check priceToY round-trips).
 */
function makeViewport(opts?: {
  candleWidth?: number;
  step?: number;
  chartLeft?: number;
  priceToY?: (p: number) => number;
}): Viewport {
  const candleWidth = opts?.candleWidth ?? 10;
  const step = opts?.step ?? 14;
  const chartLeft = opts?.chartLeft ?? 0;
  const priceToY = opts?.priceToY ?? ((p: number) => p);
  return {
    candleWidth,
    candleStep: step,
    indexToX: (index: number) => chartLeft + index * step,
    priceToY,
  } as unknown as Viewport;
}

const THEME: ThemeColors = {
  background: '#000000',
  bullCandle: '#26a69a', // (38,166,154)
  bearCandle: '#ef5350', // (239,83,80)
  bullVolume: 'rgba(38,166,154,0.3)',
  bearVolume: 'rgba(239,83,80,0.3)',
  grid: '#1e222d',
  axis: '#363a45',
  text: '#d1d4dc',
  crosshair: '#758696',
  priceLine: '#4c525e',
};

function makeLayout(overrides?: Partial<ChartLayout>): ChartLayout {
  return {
    width: 1000,
    height: 600,
    chartTop: 0,
    chartBottom: 500,
    chartLeft: 0,
    chartRight: 1000,
    volumeTop: 400,
    volumeBottom: 500,
    priceAxisWidth: 80,
    leftAxisWidth: 0,
    timeAxisHeight: 30,
    paneAreaTop: 500,
    paneAreaBottom: 570,
    paneCount: 0,
    ...overrides,
  };
}

/**
 * Build a CandleView from per-candle OHLC tuples. `offset` is the buffer index
 * of candle 0; `repIndex` (optional) marks the view conflated and overrides X
 * positioning per bucket.
 */
function makeView(
  candles: Array<{ o: number; h: number; l: number; c: number }>,
  opts?: { offset?: number; repIndex?: number[] },
): CandleView {
  const n = candles.length;
  const open = new Float64Array(n);
  const high = new Float64Array(n);
  const low = new Float64Array(n);
  const close = new Float64Array(n);
  const volume = new Float64Array(n);
  const time = new Float64Array(n);
  candles.forEach((c, i) => {
    open[i] = c.o;
    high[i] = c.h;
    low[i] = c.l;
    close[i] = c.c;
    volume[i] = 1;
    time[i] = i;
  });
  const view: CandleView = {
    open,
    high,
    low,
    close,
    volume,
    time,
    length: n,
    offset: opts?.offset ?? 0,
  };
  if (opts?.repIndex) view.repIndex = Int32Array.from(opts.repIndex);
  return view;
}

const BULL_RGB = [38 / 255, 166 / 255, 154 / 255] as const;
const BEAR_RGB = [239 / 255, 83 / 255, 80 / 255] as const;

/** Read vertex `v`'s (x, y). */
function pos(data: { positions: Float32Array }, v: number): [number, number] {
  return [data.positions[v * 2]!, data.positions[v * 2 + 1]!];
}
/** Read vertex `v`'s (r, g, b). */
function col(data: { colors: Float32Array }, v: number): [number, number, number] {
  return [data.colors[v * 3]!, data.colors[v * 3 + 1]!, data.colors[v * 3 + 2]!];
}

// --- tests ----------------------------------------------------------------

describe('buildCandleVertices', () => {
  it('emits 12 vertices per visible candle (6 wick + 6 body)', () => {
    const view = makeView([
      { o: 10, h: 20, l: 5, c: 15 },
      { o: 15, h: 25, l: 12, c: 14 },
      { o: 14, h: 18, l: 9, c: 17 },
    ]);
    const data = buildCandleVertices(view, makeViewport(), makeLayout(), THEME);
    expect(data.vertexCount).toBe(3 * 12);
    expect(data.positions.length).toBe(data.vertexCount * 2);
    expect(data.colors.length).toBe(data.vertexCount * 3);
  });

  it('places the body span at priceToY(open/close) with the right pixel edges', () => {
    // Single bull candle. priceToY identity → Y == price.
    const candleWidth = 10;
    const step = 14;
    const view = makeView([{ o: 10, h: 30, l: 5, c: 22 }]);
    const data = buildCandleVertices(
      view,
      makeViewport({ candleWidth, step }),
      makeLayout(),
      THEME,
    );

    // Vertices 0..5 are the wick, 6..11 the body. Body order from pushRect:
    // TL, BL, BR, TL, BR, TR.
    const x = 0 * step; // chartLeft(0) + index 0 * step
    const halfBody = candleWidth / 2;
    const bodyLeft = Math.round(x - halfBody); // round(-5) = -5
    const bodyRight = bodyLeft + candleWidth;
    const bodyTop = 22; // priceToY(max(open,close)=close=22)
    const bodyBottomPrice = 10; // priceToY(min(open,close)=open=10)
    const bodyHeight = Math.max(MIN_CANDLE_BODY_HEIGHT, bodyBottomPrice - bodyTop); // 12

    const tl = pos(data, 6);
    const bl = pos(data, 7);
    const br = pos(data, 8);
    const tr = pos(data, 11);
    expect(tl).toEqual([bodyLeft, bodyTop]);
    expect(bl).toEqual([bodyLeft, bodyTop + bodyHeight]);
    expect(br).toEqual([bodyRight, bodyTop + bodyHeight]);
    expect(tr).toEqual([bodyRight, bodyTop]);
  });

  it('places the wick at WICK_WIDTH around the rounded X, spanning high→low', () => {
    const step = 14;
    const view = makeView([{ o: 10, h: 30, l: 5, c: 22 }], { offset: 3 });
    const data = buildCandleVertices(
      view,
      makeViewport({ step }),
      makeLayout(),
      THEME,
    );
    const x = 3 * step; // offset 3 → buffer index 3 → X = 42
    const wickLeft = Math.round(x) - WICK_WIDTH / 2;
    // Wick verts 0..5: TL, BL, BR, TL, BR, TR.
    expect(pos(data, 0)).toEqual([wickLeft, 30]); // top at priceToY(high)
    expect(pos(data, 1)).toEqual([wickLeft, 5]); // bottom at priceToY(low)
    expect(pos(data, 2)).toEqual([wickLeft + WICK_WIDTH, 5]);
    expect(pos(data, 5)).toEqual([wickLeft + WICK_WIDTH, 30]);
  });

  it('colors a bullish candle (close>=open) with bullCandle rgb for every vertex', () => {
    const view = makeView([{ o: 10, h: 20, l: 5, c: 18 }]); // close > open → bull
    const data = buildCandleVertices(view, makeViewport(), makeLayout(), THEME);
    for (let v = 0; v < data.vertexCount; v++) {
      const [r, g, b] = col(data, v);
      expect(r).toBeCloseTo(BULL_RGB[0], 6);
      expect(g).toBeCloseTo(BULL_RGB[1], 6);
      expect(b).toBeCloseTo(BULL_RGB[2], 6);
    }
  });

  it('colors a bearish candle (close<open) with bearCandle rgb for every vertex', () => {
    const view = makeView([{ o: 18, h: 20, l: 5, c: 10 }]); // close < open → bear
    const data = buildCandleVertices(view, makeViewport(), makeLayout(), THEME);
    for (let v = 0; v < data.vertexCount; v++) {
      const [r, g, b] = col(data, v);
      expect(r).toBeCloseTo(BEAR_RGB[0], 6);
      expect(g).toBeCloseTo(BEAR_RGB[1], 6);
      expect(b).toBeCloseTo(BEAR_RGB[2], 6);
    }
  });

  it('treats open==close (doji) as bullish (close>=open) and floors body height', () => {
    const view = makeView([{ o: 12, h: 20, l: 5, c: 12 }]); // doji
    const data = buildCandleVertices(view, makeViewport(), makeLayout(), THEME);
    // Body top == bottom price (both 12) → height floored to MIN_CANDLE_BODY_HEIGHT.
    const bodyTop = pos(data, 6)[1];
    const bodyBottom = pos(data, 7)[1];
    expect(bodyBottom - bodyTop).toBe(MIN_CANDLE_BODY_HEIGHT);
    // Doji is bull (close>=open).
    expect(col(data, 6)[0]).toBeCloseTo(BULL_RGB[0], 6);
  });

  it('culls a candle whose body is left of chartLeft (no vertices)', () => {
    // Candle at index 0, X = chartLeft. Shift chartLeft far right so the body
    // (x+halfBody) lands left of it.
    const layout = makeLayout({ chartLeft: 500, chartRight: 1000 });
    const view = makeView([{ o: 10, h: 20, l: 5, c: 15 }]);
    // indexToX uses chartLeft from the viewport closure (0), so X stays at 0 →
    // fully left of layout.chartLeft=500 → culled.
    const data = buildCandleVertices(view, makeViewport(), layout, THEME);
    expect(data.vertexCount).toBe(0);
    expect(data.positions.length).toBe(0);
    expect(data.colors.length).toBe(0);
  });

  it('culls a candle whose body is right of chartRight (no vertices)', () => {
    const layout = makeLayout({ chartLeft: 0, chartRight: 100 });
    // index 50 * step 14 = X 700, well right of chartRight=100.
    const view = makeView([{ o: 10, h: 20, l: 5, c: 15 }], { offset: 50 });
    const data = buildCandleVertices(view, makeViewport(), layout, THEME);
    expect(data.vertexCount).toBe(0);
  });

  it('keeps only the visible candles when some are culled', () => {
    // Three candles at indices 0, 1, 2 (X = 0, 14, 28). chartRight=20 keeps the
    // first two bodies (halfBody=5 → index2 left edge 28-5=23 > 20 → culled).
    const layout = makeLayout({ chartLeft: 0, chartRight: 20 });
    const view = makeView([
      { o: 10, h: 20, l: 5, c: 15 },
      { o: 15, h: 25, l: 12, c: 14 },
      { o: 14, h: 18, l: 9, c: 17 },
    ]);
    const data = buildCandleVertices(view, makeViewport({ candleWidth: 10, step: 14 }), layout, THEME);
    expect(data.vertexCount).toBe(2 * 12);
  });

  it('positions a conflated view by repIndex, not offset+i, and widens to >=1px', () => {
    const step = 14;
    // Sub-pixel candleWidth (0.2) conflated: bucket 0 → repIndex 7, bucket 1 → 40.
    const view = makeView(
      [
        { o: 10, h: 20, l: 5, c: 15 },
        { o: 15, h: 25, l: 12, c: 14 },
      ],
      { repIndex: [7, 40] },
    );
    const data = buildCandleVertices(
      view,
      makeViewport({ candleWidth: 0.2, step, chartLeft: 0 }),
      makeLayout(),
      THEME,
    );
    // Body widened to max(1, 0.2) = 1 → halfBody 0.5.
    // Bucket 0 X = repIndex 7 * step = 98; bucket 1 X = 40 * step = 560.
    const bucket0BodyLeft = Math.round(98 - 0.5); // round(97.5) = 98
    const bucket1BodyLeft = Math.round(560 - 0.5); // round(559.5) = 560
    // Bucket 0 body is verts 6..11; bucket 1 body is verts 18..23.
    expect(pos(data, 6)[0]).toBe(bucket0BodyLeft);
    expect(pos(data, 18)[0]).toBe(bucket1BodyLeft);
    // Body width is 1px (right - left).
    expect(pos(data, 8)[0] - pos(data, 6)[0]).toBe(1);
  });

  it('uses priceToY for Y mapping (non-identity scale)', () => {
    // priceToY(p) = 500 - p so higher prices sit nearer the top (smaller Y),
    // matching the real viewport's inverted axis.
    const priceToY = (p: number) => 500 - p;
    const view = makeView([{ o: 10, h: 30, l: 5, c: 22 }]);
    const data = buildCandleVertices(view, makeViewport({ priceToY }), makeLayout(), THEME);
    // Body top = priceToY(max(open,close)=22) = 478.
    expect(pos(data, 6)[1]).toBe(478);
    // Wick top = priceToY(high=30) = 470, wick bottom = priceToY(low=5) = 495.
    expect(pos(data, 0)[1]).toBe(470);
    expect(pos(data, 1)[1]).toBe(495);
  });

  it('returns empty buffers for an empty view', () => {
    const view = makeView([]);
    const data = buildCandleVertices(view, makeViewport(), makeLayout(), THEME);
    expect(data.vertexCount).toBe(0);
    expect(data.positions.length).toBe(0);
    expect(data.colors.length).toBe(0);
  });
});
