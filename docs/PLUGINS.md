# Plugin API

`@rekurt/ohlcv-core` exposes three stable extension points so you can add
chart types, overlays, and sub-pane decorations without forking the library:

1. **Custom Series** — a new primary chart type that participates in autoscale,
   conflation, and the legend (alongside `candles`/`line`/`area`/`ohlc`/
   `heikinashi`/`baseline`).
2. **Series Primitives** — imperative overlays painted at a chosen z-tier over
   the main price pane (price lines, session bands, watermarks).
3. **Pane Primitives** — the same `Primitive`, self-clipped to an indicator
   sub-pane band, for decorating an oscillator pane (RSI/MACD/…).

All three receive the chart's coordinate transforms (`viewport.indexToX`,
`viewport.priceToY`), so they inherit price-scale-mode correctness (linear /
log / percentage / indexed) for free.

---

## 1. Custom Series

Implement `SeriesDefinition` and register it. The `type` string is what you
pass to `setChartType` / persist in state.

```ts
import { type SeriesDefinition, registerSeriesType } from '@rekurt/ohlcv-core';

const stepLineSeries: SeriesDefinition = {
  type: 'stepline',
  draw: ({ ctx, layout, viewport, view, theme }) => {
    ctx.save();
    ctx.strokeStyle = theme.bullCandle;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let prevY: number | null = null;
    for (let i = 0; i < view.length; i++) {
      const x = viewport.indexToX(view.repIndex ? view.repIndex[i]! : view.offset + i);
      const y = viewport.priceToY(view.close[i]!);
      if (prevY === null) ctx.moveTo(x, y);
      else { ctx.lineTo(x, prevY); ctx.lineTo(x, y); } // step
      prevY = y;
    }
    ctx.stroke();
    ctx.restore();
  },
  // Optional: tighten autoscale to close-only instead of the default low/high.
  priceRange: (view, i) => ({ min: view.close[i]!, max: view.close[i]! }),
};

chart.registerSeriesType(stepLineSeries); // OHLCVChart facade
chart.setChartType('stepline');
```

`SeriesDefinition` hooks:

- `draw(ctx)` — paint the (already transformed + possibly conflated) `view`.
- `priceRange?(view, i)` — min/max a row contributes to autoscale (default:
  candle low/high). Present → autoscale scans the view (skips the range pyramid).
- `transformView?(buffer, start, end)` — produce a synthetic index-aligned
  `CandleView` (this is how the built-in Heikin-Ashi series works).

A conflated view carries `repIndex`; position with
`viewport.indexToX(view.repIndex ? view.repIndex[i]! : view.offset + i)` so your
series stays correct at full zoom-out.

---

## 2. Series Primitives

A `Primitive` is an imperative overlay the host attaches/detaches directly.
Unlike a `Drawing` (user-created, undoable, persisted), a primitive has no
undo/persistence — just a `draw` at a chosen z-tier.

```ts
import { type Primitive, clipToChart } from '@rekurt/ohlcv-core';

class TargetLine implements Primitive {
  readonly id = 'target-line';
  zOrder = 'top' as const; // 'bottom' | 'normal' | 'top'
  constructor(private price: number) {}

  draw(ctx, layout, viewport, theme, priceFormat) {
    const y = viewport.priceToY(this.price);
    ctx.save();
    clipToChart(ctx, layout);
    ctx.strokeStyle = '#f5a623';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(layout.chartLeft, y);
    ctx.lineTo(layout.chartRight, y);
    ctx.stroke();
    ctx.restore();
  }

  // Optional: make it draggable / hover-detectable.
  hitTest(x, y, layout, viewport, tol = 4) {
    return Math.abs(y - viewport.priceToY(this.price)) <= tol;
  }
}

const handle = new TargetLine(105);
chart.attachPrimitive(handle);
// ... later
chart.detachPrimitive('target-line');
```

Z-tiers (relative to the fixed paint order):

- `'bottom'` — behind grid + series (watermarks, session shading)
- `'normal'` — with the drawing layer, above series/indicators
- `'top'` — above everything on the UI layer (price lines + their axis pills)

A primitive with a `hitTest` is reported via `HoverInfo.hovered`
(`{ kind: 'primitive', id }`) on hover, and can be wired for dragging.

---

## 3. Pane Primitives

A pane primitive is just a `Primitive` that paints inside an indicator
sub-pane band instead of the main price area. Use `clipToPane` /
`paneBounds` — sub-panes have **independent Y scales**, so map your values
into the band bounds yourself (do *not* use `viewport.priceToY`, which is the
main price axis).

```ts
import { type Primitive, clipToPane, paneBounds } from '@rekurt/ohlcv-core';

/** Shade the 30/70 RSI zone on sub-pane 1. */
class RsiZone implements Primitive {
  readonly id = 'rsi-zone';
  zOrder = 'normal' as const;
  constructor(private paneIndex = 1) {}

  draw(ctx, layout, viewport) {
    const { top, bottom } = paneBounds(layout, this.paneIndex);
    const yOf = (v: number) => bottom - (v / 100) * (bottom - top); // RSI is 0..100
    ctx.save();
    clipToPane(ctx, layout, this.paneIndex);
    ctx.fillStyle = 'rgba(128,128,128,0.10)';
    ctx.fillRect(layout.chartLeft, yOf(70), layout.chartRight - layout.chartLeft, yOf(30) - yOf(70));
    ctx.restore();
  }
}

chart.attachPrimitive(new RsiZone(1));
```

`paneIndex` is `1..paneCount` (top→bottom). Pane `0`, an absent pane, or a
chart with no sub-panes degrades to the main price area, so a primitive that
asks for a pane that isn't there still renders (in the main pane) instead of
vanishing.

---

## Reference

| Symbol | Purpose |
|---|---|
| `SeriesDefinition`, `registerSeriesType`, `getSeriesType`, `listSeriesTypes` | Custom primary series |
| `Primitive`, `PrimitiveZOrder` | Overlay contract |
| `chart.attachPrimitive(p)`, `chart.detachPrimitive(id)` | Attach/detach overlays |
| `clipToChart(ctx, layout)` | Clip to main price area |
| `clipToPane(ctx, layout, paneIndex)` | Clip to a sub-pane band |
| `paneBounds(layout, paneIndex)` | `{ top, bottom }` pixel bounds of a pane |

See also `BaselineRenderer` + `createBaselineSeries` in `series/builtins.ts`
for a real built-in series, and `WatermarkPrimitive` / `PriceLinePrimitive`
for real built-in primitives.
