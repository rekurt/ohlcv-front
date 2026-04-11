import { useCallback, useMemo, useState } from 'react';
import type {
  ChartType,
  IndicatorConfig,
  LayoutState,
  ThemeMode,
} from '@rekurt/ohlcv-core';
import { SYMBOLS, RESOLUTIONS, generateCandles } from '@ohlcv-examples/shared';
import { CoreTab } from './tabs/CoreTab';
import { ReactTab } from './tabs/ReactTab';
import { VueTab } from './tabs/VueTab';
import { buildShareUrl, readStateFromUrl } from './shareUrl';

type Framework = 'core' | 'react' | 'vue';

type IndicatorId = 'sma20' | 'ema50' | 'bb' | 'rsi14' | 'macd';

const INDICATOR_CONFIG: Record<IndicatorId, IndicatorConfig> = {
  sma20: { type: 'sma', period: 20 },
  ema50: { type: 'ema', period: 50 },
  bb: { type: 'bb', period: 20, stdDev: 2 },
  rsi14: { type: 'rsi', period: 14 },
  macd: { type: 'macd', fast: 12, slow: 26, signal: 9 },
};

const CANDLE_COUNT = 500;

/**
 * Unified playground for the three @rekurt/ohlcv packages. Tab switcher
 * re-mounts one of three tab components — each uses its own framework
 * (vanilla core, React wrapper, Vue wrapper) against the same generated
 * candle buffer and the same toolbar state (theme, chartType, indicators).
 *
 * "Share this chart" pulls the current chart's LayoutState through the
 * ref API, base64-encodes it, and writes it to `window.location`. On
 * load, the App reads the state from `?state=` and feeds it into the
 * active tab as initial state.
 */
export function App() {
  const [framework, setFramework] = useState<Framework>('react');
  const [symbolId, setSymbolId] = useState(SYMBOLS[0]!.id);
  const [resolutionId, setResolutionId] = useState('1H');
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [chartType, setChartType] = useState<ChartType>('candles');
  const [indicators, setIndicators] = useState<Set<IndicatorId>>(
    () => new Set(),
  );
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  const symbol = useMemo(
    () => SYMBOLS.find((s) => s.id === symbolId) ?? SYMBOLS[0]!,
    [symbolId],
  );
  const resolution = useMemo(
    () => RESOLUTIONS.find((r) => r.id === resolutionId) ?? RESOLUTIONS[0]!,
    [resolutionId],
  );

  // Mock data regenerated only when symbol/resolution change — same
  // mental model as the existing framework-specific examples.
  const candles = useMemo(
    () => generateCandles({ symbol, resolution, count: CANDLE_COUNT }),
    [symbol, resolution],
  );

  const indicatorConfigs = useMemo<IndicatorConfig[]>(
    () => Array.from(indicators).map((id) => INDICATOR_CONFIG[id]),
    [indicators],
  );

  const initialState = useMemo<LayoutState | null>(() => readStateFromUrl(), []);
  // Apply the initial state's declarative fields the first render, so the
  // active tab starts in the shared state.
  useMemo(() => {
    if (!initialState) return;
    setSymbolId(initialState.symbol);
    setResolutionId(initialState.resolution);
    setChartType(initialState.chartType);
    if (typeof initialState.theme === 'string') {
      setTheme(initialState.theme as ThemeMode);
    }
    const idSet = new Set<IndicatorId>();
    for (const cfg of initialState.indicators) {
      const id = (Object.keys(INDICATOR_CONFIG) as IndicatorId[]).find(
        (k) => JSON.stringify(INDICATOR_CONFIG[k]) === JSON.stringify(cfg),
      );
      if (id) idSet.add(id);
    }
    setIndicators(idSet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleIndicator = useCallback((id: IndicatorId) => {
    setIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onShare = useCallback(
    (layoutState: LayoutState | null) => {
      if (!layoutState) return;
      const url = buildShareUrl(layoutState);
      void navigator.clipboard.writeText(url).then(
        () => setShareMsg('Copied share URL to clipboard'),
        () => setShareMsg('Could not copy — URL in console'),
      );
      console.info('share URL:', url);
      window.setTimeout(() => setShareMsg(null), 3000);
    },
    [],
  );

  // Each tab receives a prop-controlled `onRequestShare` which gives the
  // currently-focused chart an opportunity to produce its LayoutState.
  const [shareRequest, setShareRequest] = useState<
    (() => LayoutState | null) | null
  >(null);
  const registerShareFn = useCallback(
    (fn: (() => LayoutState | null) | null) => {
      setShareRequest(() => fn);
    },
    [],
  );
  const handleShareClick = useCallback(() => {
    const layoutState = shareRequest?.();
    onShare(layoutState ?? null);
  }, [shareRequest, onShare]);

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">@rekurt/ohlcv playground</span>
        <div className="framework-tabs">
          {(['core', 'react', 'vue'] as Framework[]).map((f) => (
            <button
              key={f}
              className={framework === f ? 'tab active' : 'tab'}
              onClick={() => setFramework(f)}
            >
              {f === 'core' ? 'Vanilla TS' : f === 'react' ? 'React' : 'Vue'}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <label>Symbol</label>
        <select value={symbolId} onChange={(e) => setSymbolId(e.target.value)}>
          {SYMBOLS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <label>TF</label>
        <select
          value={resolutionId}
          onChange={(e) => setResolutionId(e.target.value)}
        >
          {RESOLUTIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id}
            </option>
          ))}
        </select>
        <label>Type</label>
        <select
          value={chartType}
          onChange={(e) => setChartType(e.target.value as ChartType)}
        >
          <option value="candles">Candles</option>
          <option value="line">Line</option>
          <option value="area">Area</option>
          <option value="ohlc">OHLC Bars</option>
        </select>
        <div className="indicators">
          {(Object.keys(INDICATOR_CONFIG) as IndicatorId[]).map((id) => (
            <label key={id}>
              <input
                type="checkbox"
                checked={indicators.has(id)}
                onChange={() => toggleIndicator(id)}
              />
              {id}
            </label>
          ))}
        </div>
        <button
          onClick={() => {
            const next = theme === 'dark' ? 'light' : 'dark';
            setTheme(next);
            document.documentElement.style.colorScheme = next;
          }}
        >
          {theme === 'dark' ? '🌙' : '☀'}
        </button>
        <button onClick={handleShareClick}>Share</button>
      </header>

      {shareMsg && <div className="share-msg">{shareMsg}</div>}

      <main className="chart-host">
        {framework === 'core' && (
          <CoreTab
            symbol={symbol}
            resolution={resolution}
            candles={candles}
            theme={theme}
            chartType={chartType}
            indicators={indicatorConfigs}
            registerShareFn={registerShareFn}
            initialState={initialState}
          />
        )}
        {framework === 'react' && (
          <ReactTab
            symbol={symbol.label}
            resolution={resolution.id}
            candles={candles}
            theme={theme}
            chartType={chartType}
            indicators={indicatorConfigs}
            registerShareFn={registerShareFn}
            initialState={initialState}
          />
        )}
        {framework === 'vue' && (
          <VueTab
            symbol={symbol.label}
            resolution={resolution.id}
            candles={candles}
            theme={theme}
            chartType={chartType}
            indicators={indicatorConfigs}
            registerShareFn={registerShareFn}
            initialState={initialState}
          />
        )}
      </main>
    </div>
  );
}
