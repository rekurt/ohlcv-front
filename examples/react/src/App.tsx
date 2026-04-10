import { useEffect, useMemo, useRef, useState } from 'react';
import { OHLCVChart, type OHLCVChartRef } from '@ohlcv/react';
import { formatPrice, formatTime, type Candle, type ThemeMode } from '@ohlcv/core';
import {
  SYMBOLS,
  RESOLUTIONS,
  generateCandles,
  advanceLastCandle,
} from '@ohlcv-examples/shared';
import { Toolbar } from './Toolbar';

const CANDLE_COUNT = 500;
const LIVE_TICK_MS = 500;

export function App() {
  const [symbolId, setSymbolId] = useState(SYMBOLS[0].id);
  const [resolutionId, setResolutionId] = useState('1H');
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [live, setLive] = useState(false);
  const [status, setStatus] = useState('Click a candle to see details');

  const symbol = useMemo(
    () => SYMBOLS.find((s) => s.id === symbolId) ?? SYMBOLS[0],
    [symbolId],
  );
  const resolution = useMemo(
    () => RESOLUTIONS.find((r) => r.id === resolutionId) ?? RESOLUTIONS[0],
    [resolutionId],
  );

  // Regenerate data whenever symbol or resolution changes.
  // We use a ref for the mutable candles array the live loop pushes into,
  // plus a state counter that forces the chart to re-read it.
  const candlesRef = useRef<Candle[]>([]);
  const [dataVersion, setDataVersion] = useState(0);

  const data = useMemo(() => {
    const next = generateCandles({ symbol, resolution, count: CANDLE_COUNT });
    candlesRef.current = next;
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, resolution, dataVersion]);

  const chartRef = useRef<OHLCVChartRef>(null);

  // Live simulation — mutates the last candle every LIVE_TICK_MS.
  useEffect(() => {
    if (!live) return;
    let tickIndex = 0;
    const timer = setInterval(() => {
      const core = chartRef.current?.chart;
      const arr = candlesRef.current;
      if (!core || arr.length === 0) return;
      const last = arr[arr.length - 1];
      const next = advanceLastCandle({ lastCandle: last, symbol, tickIndex: ++tickIndex });
      arr[arr.length - 1] = next;
      core.updateLastCandle(next);
    }, LIVE_TICK_MS);
    return () => clearInterval(timer);
  }, [live, symbol]);

  // Stop live when switching symbol/resolution — otherwise the interval
  // keeps writing old-symbol deltas into the new dataset.
  useEffect(() => {
    if (live) {
      setLive(false);
      setDataVersion((v) => v + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolId, resolutionId]);

  const handleCandleClick = (candle: Candle, index: number) => {
    setStatus(
      `#${index}  ${formatTime(candle.t, resolution.id)}  ` +
        `O ${formatPrice(candle.o)}  H ${formatPrice(candle.h)}  ` +
        `L ${formatPrice(candle.l)}  C ${formatPrice(candle.c)}  ` +
        `V ${Math.round(candle.v)}`,
    );
  };

  return (
    <>
      <Toolbar
        symbols={SYMBOLS}
        resolutions={RESOLUTIONS}
        symbolId={symbolId}
        resolutionId={resolutionId}
        theme={theme}
        live={live}
        status={status}
        onSymbolChange={setSymbolId}
        onResolutionChange={setResolutionId}
        onThemeToggle={() => {
          const next = theme === 'dark' ? 'light' : 'dark';
          setTheme(next);
          document.documentElement.style.colorScheme = next;
        }}
        onLiveToggle={() => setLive((v) => !v)}
      />
      <div className="chart-wrap">
        <OHLCVChart
          ref={chartRef}
          symbol={symbol.label}
          resolution={resolution.id}
          data={data}
          theme={theme}
          onCandleClick={handleCandleClick}
        />
      </div>
    </>
  );
}

// ---- Alternative: hook-based usage ----
//
// import { useOHLCVChart } from '@ohlcv/react';
//
// function AppWithHook() {
//   const { containerRef, setData, updateLastCandle } = useOHLCVChart({
//     symbol: 'BTC/USDT',
//     resolution: '1H',
//     theme: 'dark',
//   });
//   useEffect(() => {
//     setData(generateCandles({ symbol: SYMBOLS[0], resolution: RESOLUTIONS[3], count: 500 }));
//   }, [setData]);
//   return <div ref={containerRef} style={{ width: '100%', height: '100vh' }} />;
// }
