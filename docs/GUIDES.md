# Guides

Practical recipes for `@rekurt/ohlcv-*`. For the API reference see the
[TypeDoc site](https://rekurt.github.io/ohlcv-front/api/); for a live
demo see the [playground](https://rekurt.github.io/ohlcv-front/).

- [SSR integration (Next.js / Nuxt)](#ssr-integration)
- [Performance tuning](#performance-tuning)
- [Theming & customization](#theming--customization)
- [Live data & transports](#live-data--transports)
- [Indicators](#indicators)
- [Drawing tools](#drawing-tools)
- [State persistence & share links](#state-persistence--share-links)

---

## SSR integration

The chart needs a real DOM canvas, so it can only initialize in the
browser. Both wrappers are SSR-safe — no DOM is touched at module scope
— but you must avoid rendering the chart during the server pass.

### Next.js (app router)

Mark the chart component as client-only:

```tsx
'use client';

import { OHLCVChart } from '@rekurt/ohlcv-react';

export function Chart({ candles }: { candles: Candle[] }) {
  return (
    <div style={{ height: 600 }}>
      <OHLCVChart symbol="BTC/USDT" resolution="1H" data={candles} />
    </div>
  );
}
```

If you import the chart from a server component, wrap it with
`next/dynamic` and disable SSR so the bundle isn't evaluated on the
server:

```tsx
import dynamic from 'next/dynamic';

const Chart = dynamic(() => import('./Chart').then((m) => m.Chart), {
  ssr: false,
});
```

### Nuxt 3

Use `<ClientOnly>` (or a `.client.vue` suffix) around the chart:

```vue
<template>
  <ClientOnly>
    <OHLCVChart symbol="BTC/USDT" resolution="1H" :data="candles" />
  </ClientOnly>
</template>
```

### Gotchas

- The container must have a non-zero size when the chart mounts. A
  `height: 0` parent (common in flex layouts before hydration settles)
  makes the first layout a no-op; the chart recovers on the next
  `ResizeObserver` tick, but you'll see a one-frame blank. Give the
  container an explicit height.
- Hydration mismatches: never render different markup on server vs.
  client. Render an empty sized `<div>` placeholder on both.

---

## Performance tuning

The core is built for large datasets — `Float64Array` buffers,
viewport culling, dirty-flag RAF rendering, and a three-layer canvas
split so crosshair moves don't repaint candles. A few knobs and
patterns help at scale:

### Large history & infinite scroll

`CandleBuffer.prepend` is amortized O(1): the buffer keeps a logical
head offset and reserves leftPad on growth, so paging history in
fixed-size batches doesn't reallocate. Implement infinite scroll with
`onLoadMoreHistory`:

```ts
new OHLCVChart({
  container,
  symbol: 'BTC/USDT',
  resolution: '1H',
  onLoadMoreHistory: async (buffer) => {
    const older = await fetchOlderCandles(buffer.firstTime());
    chart.prependHistory(older); // O(1) amortized, view preserved
  },
});
```

The chart already serializes `onLoadMoreHistory` — only one call is in
flight at a time — but a production handler should also dedupe against the
data it already has and bail out when the source is exhausted, so a user
who keeps scrolling at the left edge doesn't refetch the same page or
spin forever:

```ts
let exhausted = false;

onLoadMoreHistory: async (buffer) => {
  if (exhausted) return;
  const before = buffer.firstTime();           // oldest candle we hold
  // Most REST endpoints cap a page (e.g. Binance klines = 1000). Page by
  // the oldest timestamp and request the slice strictly older than it.
  const page = await fetchOlderCandles({ endTime: before, limit: 1000 });

  // Drop anything at/after what we already have so prepend()'s
  // monotonicity filter doesn't silently discard a half-overlapping page.
  const older = page.filter((c) => c.t < before);
  if (older.length === 0) {
    exhausted = true;                          // reached the start of history
    return;
  }
  chart.prependHistory(older);                  // shifts startIndex to keep view
};
```

Pair this with `maxCandles` to bound memory on a chart the user scrolls
through for hours: eviction trims the newest-side overflow from the head
and keeps the viewport and any drawings anchored to the same candles.

```ts
new OHLCVChart({ container, symbol, resolution, maxCandles: 50_000 });
```

To find missing candles in what you've loaded (weekend gaps, dropped
ticks), use `findGaps` with `resolutionToSeconds`:

```ts
import { findGaps, resolutionToSeconds } from '@rekurt/ohlcv-core';

const interval = resolutionToSeconds('1H'); // 3600, or null for '1M'
if (interval) {
  for (const gap of findGaps(chart.getBuffer(), interval)) {
    console.log(`missing ~${gap.missingCount} candles`, gap.fromTime, gap.toTime);
  }
}
```

### Live updates without view jumps

Pass `preserveView: true` (the React/Vue wrappers do this for you on
`data` prop changes) so unrelated re-renders don't snap the viewport
back to the live edge. For per-tick updates use `updateLastCandle`
(O(1)) rather than rebuilding the whole array.

### Indicators

All built-in indicators are O(n) or amortized O(1) (rolling sums,
monotonic-deque window extrema, Wilder smoothing). Still, every active
indicator recomputes over the buffer on a dirty render — keep the
active set reasonable (a handful) for 100k+ candle buffers. Prefer the
declarative `indicators` prop / `setIndicatorConfigs` so reference-
stable arrays skip recomputation via `diffIndicatorConfigs`.

### Bundle size

Import only what you use via subpath exports to help tree-shaking:

```ts
import { SMA, RSI } from '@rekurt/ohlcv-core/indicators';
import { TrendLine } from '@rekurt/ohlcv-core/drawings';
```

Run `npm run size` to see current gzip sizes (core ~27 KB, react
~2 KB, vue ~2.5 KB gzipped).

### Measuring

There is no built-in profiler. Use the browser's Performance panel and
watch for long RAF frames. The dirty-flag system means a static chart
costs ~0 between frames; if you see continuous repaints, something is
calling `requestRender`/`setData` in a loop.

---

## Theming & customization

### Built-in modes

```ts
chart.setTheme('dark');   // default
chart.setTheme('light');
chart.setTheme('auto');   // follows prefers-color-scheme
```

### Custom theme object

Pass a full `ThemeColors` object to override any token:

```ts
import type { ThemeColors } from '@rekurt/ohlcv-core';

const myTheme: ThemeColors = {
  background: '#0d1117',
  bullCandle: '#26a69a',
  bearCandle: '#ef5350',
  bullVolume: 'rgba(38,166,154,0.5)',
  bearVolume: 'rgba(239,83,80,0.5)',
  grid: '#1c2128',
  axis: '#30363d',
  text: '#c9d1d9',
  crosshair: '#8b949e',
  priceLine: '#58a6ff',
};

chart.setTheme(myTheme);
```

In React/Vue pass the same object as the `theme` prop. Changing the
prop calls `setTheme` under the hood.

### Custom price / volume formatting

```ts
new OHLCVChart({
  container,
  symbol: 'BTC/USDT',
  resolution: '1H',
  priceFormat: (p) => `$${p.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
  volumeFormat: (v) => `${(v / 1000).toFixed(1)}K`,
});
```

---

## Live data & transports

Implement the `DataTransport` interface (four methods) to feed any
source:

```ts
import type { DataTransport, Candle, HistoryRequest, DataFeedConfig } from '@rekurt/ohlcv-core';

class MyTransport implements DataTransport {
  async fetchHistory(req: HistoryRequest): Promise<Candle[]> {
    const res = await fetch(`/api/klines?symbol=${req.symbol}&from=${req.from}&to=${req.to}`);
    return res.json(); // must be ascending by time
  }
  subscribe(config: DataFeedConfig, onUpdate: (candles: Candle[]) => void): void {
    this.ws = new WebSocket(`wss://example.com/${config.symbol}`);
    this.ws.onmessage = (e) => onUpdate([parseCandle(e.data)]);
  }
  unsubscribe(): void { this.ws?.close(); }
  destroy(): void { this.ws?.close(); }
}
```

`DataFeed` protects against stale responses (a symbol switch mid-fetch
won't render the wrong data) and reports transport errors through
`onError` — both `fetchHistory` rejections and `subscribe` throws are
caught, never silently swallowed.

`PollingTransport` (HTTP polling) and `WebSocketTransport` (abstract WS
base) are provided. Build exchange-specific adapters (Binance, etc.) by
subclassing `WebSocketTransport`.

---

## Indicators

Indicators are declarative config objects, never `new SMA(20)` in app
code:

```ts
chart.setIndicatorConfigs([
  { type: 'sma', period: 20 },
  { type: 'ema', period: 50 },
  { type: 'bb', period: 20, stdDev: 2 },
  { type: 'vwap', anchor: { type: 'anchored', t: 1_700_000_000 } },
  { type: 'rsi', period: 14 },         // renders in its own sub-pane
  { type: 'macd', fast: 12, slow: 26, signal: 9 },
]);
```

Overlay indicators draw on the price pane; sub-pane indicators (RSI,
MACD, Stochastic, ATR, WilliamsR, OBV, ADX, CCI, MFI, StochRSI, ROC)
get their own auto-sized vertical band with an independent Y-axis.

To add a custom indicator, subclass `Indicator` and pass instances via
the legacy `setIndicators(Indicator[])` path.

---

## Drawing tools

```ts
chart.startDrawing('trendline'); // arm the tool, then route clicks:
container.addEventListener('click', (e) => {
  const vp = chart.getViewport();
  const index = vp.xToIndex(e.offsetX);
  const price = vp.yToPrice(e.offsetY);
  chart.getDrawingLayer().addPoint({ index, price });
});
```

Available tools: `trendline`, `hline`, `vline`, `rectangle`, `ray`,
`fib`, `fibext`, `channel`, `arrow`. Drawings are anchored in buffer
space (index + price) so they stick to candles on pan/zoom, and they
round-trip through `saveLayoutState` / `loadState`.

---

## State persistence & share links

```ts
// Compact layout state — fits in a URL query param.
const state = chart.saveLayoutState();
const url = `${location.origin}?state=${btoa(JSON.stringify(state))}`;

// Restore (e.g. on load):
const param = new URLSearchParams(location.search).get('state');
if (param) chart.loadState(JSON.parse(atob(param)));
```

`saveFullState()` additionally embeds the candle window for workspace
persistence / bug repro. `loadState` validates untrusted input and runs
schema migrations (`migrateState`), so older saved states keep loading
after the schema version bumps.
