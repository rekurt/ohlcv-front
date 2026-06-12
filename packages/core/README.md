# @rekurt/openkline-core

Framework-agnostic OHLCV (candlestick) chart library. Zero runtime dependencies. Canvas-based rendering. TypedArray buffers.

This is the core of the [**OpenKline**](https://github.com/rekurt/openkline) monorepo. For framework wrappers see [`@rekurt/openkline-react`](https://github.com/rekurt/openkline-react) and [`@rekurt/openkline-vue`](https://github.com/rekurt/openkline-vue).

## Install

```bash
npm install @rekurt/openkline-core
```

## Quick start

```ts
import { OHLCVChart } from '@rekurt/openkline-core';

const chart = new OHLCVChart({
  container: document.getElementById('chart')!,
  symbol: 'BTC/USDT',
  resolution: '1H',
  theme: 'auto',       // or 'dark' | 'light'
  onError: (err) => console.error(err),
});

chart.setData([
  { o: 42000, h: 42100, l: 41900, c: 42050, v: 1_000, t: 1_700_000_000 },
  // ...
]);
```

## Features

- Candlesticks, volume, grid, price + time axes, crosshair, current-price line, legend, "Go to live" pill
- Alternative renderers: `LineRenderer`, `AreaRenderer`, `OHLCBarRenderer`
- Multi-pane support via `Pane` + `PaneLayout` (linear / log Y-axis per pane)
- Indicators: `SMA`, `EMA`, `BollingerBands`, `RSI` — extend via the `Indicator` base class
- Mouse drag + momentum (respects `prefers-reduced-motion`), smooth wheel zoom, trackpad horizontal swipe → pan
- Keyboard shortcuts: arrows, +/-, Home/End, F (fit-all), 0 (fit-visible)
- Auto-follow state machine: live updates track the right edge unless the user panned away
- Transports: `PollingTransport`, `WebSocketTransport` (abstract base for custom WS adapters)
- Structured error dispatch via `onError` callback and `ErrorReporter`
- Runtime candle validation: `validateCandles`
- Exponential backoff with jitter for WS reconnects

## Status

Active development. Core rendering, data, and interaction layers are stable with extensive unit tests (450+). Sub-pane indicators (RSI, MACD, Stochastic, ATR) render in their own stacked panes via the `Pane`/`PaneLayout` abstraction. Advanced drawing tools and a larger indicator catalog are on the roadmap.

## License

MIT
