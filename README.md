# @ohlcv

A fast, framework-agnostic OHLCV chart library for the web. Canvas-based rendering, TypedArray buffers, explicit auto-follow state machine, keyboard-first UX, pluggable indicators and transports.

Monorepo contents:

| Package           | Purpose                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `@rekurt/ohlcv-core`     | Framework-agnostic rendering + data + interaction (no React/Vue)   |
| `@rekurt/ohlcv-react`    | Thin React 19 wrapper (`<OHLCVChart>` component + `useOHLCVChart`) |
| `@rekurt/ohlcv-vue`      | Thin Vue 3 wrapper (`OHLCVChart` component + `useOHLCVChart`)      |

Plus three runnable demo apps under `examples/` (vanilla, React, Vue) that share a seeded mock data feed.

## Quick start (development)

```bash
npm install
npm run build          # build all three library packages
npm run dev:core       # → http://localhost:5173
npm run dev:react      # → http://localhost:5174
npm run dev:vue        # → http://localhost:5175
npm test               # vitest — 328+ tests across core
npm run typecheck      # strict tsc across all six tsconfigs
```

## What's in the core library

**Rendering** (`@rekurt/ohlcv-core`):
- Candlesticks, volume bars, grid, price axis, time axis, crosshair with snap-to-candle, current price label, legend, "Go to live" pill
- Alternative chart types: line, area (with gradient), OHLC bars
- Hi-DPI canvas with three-layer split (chart / UI / interaction) for cheap crosshair redraws
- `Pane` + `PaneLayout` abstraction for multi-pane charts with independent Y-axes (linear or log)
- Theme system: dark, light, or `'auto'` following `prefers-color-scheme`

**Data layer**:
- `CandleBuffer` — O(1) `append`/`updateLast`, O(n) `prepend`, backing `Float64Array`
- `CandleMerger` — RAF-coalesced realtime tick merging
- `DataFeed` — stale-response protection via version counter
- `PollingTransport` — HTTP polling with custom parser
- `WebSocketTransport` — abstract base for WS adapters
- `BinanceWsTransport` — concrete WS adapter for Binance klines (skeleton)
- `ExponentialBackoff` — jittered reconnect policy
- `validateCandle` / `validateCandles` — runtime shape & invariant checks
- `ErrorReporter` + `onError` callback — structured error dispatch, no silent catches

**Interaction**:
- Mouse drag pan with momentum (respects `prefers-reduced-motion`)
- Wheel handling with axis priority: trackpad horizontal → pan, vertical → smooth zoom, shift+wheel → pan
- Touch: single-finger pan, two-finger pinch-zoom
- `KeyboardController`: ← → pan, ↑ ↓ / + - zoom, Home / End / 0 / F navigation
- `autoFollow` state machine: live updates track the right edge unless the user pans away
- Double-click: fit visible

**Indicators** (`@rekurt/ohlcv-core/indicators`):
- `SMA`, `EMA`, `BollingerBands` (overlay on main pane)
- `RSI` (sub-pane, placement: `'pane'`)
- Base class `Indicator` + `IndicatorSeries` — add your own by subclassing

## Minimal usage (vanilla)

```ts
import { OHLCVChart, SMA } from '@rekurt/ohlcv-core';

const chart = new OHLCVChart({
  container: document.getElementById('chart')!,
  symbol: 'BTC/USDT',
  resolution: '1H',
  theme: 'auto',
  onError: (err) => console.error('[chart]', err),
});

chart.setData(historicalCandles);

// Optional: compute an indicator for your own overlay renderer
const sma = new SMA(20);
const [{ values }] = sma.compute(chart.getBuffer());

// Live mode
setInterval(() => {
  chart.updateLastCandle(latestCandle);
}, 500);
```

## React

```tsx
import { OHLCVChart, type OHLCVChartRef } from '@rekurt/ohlcv-react';
import { useRef } from 'react';

function App() {
  const chartRef = useRef<OHLCVChartRef>(null);
  return (
    <OHLCVChart
      ref={chartRef}
      symbol="BTC/USDT"
      resolution="1H"
      data={candles}
      theme="auto"
      onCandleClick={(candle, i) => console.log('clicked', i, candle)}
    />
  );
}
```

## Vue 3

```vue
<script setup lang="ts">
import { OHLCVChart } from '@rekurt/ohlcv-vue';
import { ref } from 'vue';
const candles = ref([]);
</script>
<template>
  <OHLCVChart symbol="BTC/USDT" resolution="1H" :data="candles" theme="auto" />
</template>
```

## Status

The library is actively developed. Core primitives are stable and well-tested (328+ unit tests, strict TypeScript including `noUncheckedIndexedAccess`). Advanced features (drawing tools, full indicator catalog, multi-pane rendering integration, production Binance testing) are on the roadmap. See `CHANGELOG.md` for recent work.

## License

MIT
