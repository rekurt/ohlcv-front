import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OHLCVChart, type OHLCVChartRef } from '@rekurt/ohlcv-react';
import {
  formatPrice,
  formatTime,
  SMA,
  EMA,
  BollingerBands,
  VWAP,
  DrawingLayer,
  TrendLine,
  HorizontalLine,
  toHeikinAshi,
  toRenko,
  type Candle,
  type ChartType,
  type HoverInfo,
  type Indicator,
  type ThemeMode,
} from '@rekurt/ohlcv-core';
import {
  SYMBOLS,
  RESOLUTIONS,
  generateCandles,
  advanceLastCandle,
} from '@ohlcv-examples/shared';

type DrawingTool = 'none' | 'trendline' | 'hline';
type DataTransform = 'none' | 'heikin-ashi' | 'renko';
type IndicatorId = 'sma20' | 'ema50' | 'bb' | 'vwap';

const CANDLE_COUNT = 500;
const LIVE_TICK_MS = 500;
const RENKO_BRICK_RATIO = 0.001;

export function App() {
  // ---- Selection state ----
  const [symbolId, setSymbolId] = useState(SYMBOLS[0]!.id);
  const [resolutionId, setResolutionId] = useState('1H');
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [chartType, setChartType] = useState<ChartType>('candles');
  const [dataTransform, setDataTransform] = useState<DataTransform>('none');
  const [live, setLive] = useState(false);
  const [indicatorSet, setIndicatorSet] = useState<Set<IndicatorId>>(() => new Set());
  const [activeTool, setActiveTool] = useState<DrawingTool>('none');
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);

  const symbol = useMemo(
    () => SYMBOLS.find((s) => s.id === symbolId) ?? SYMBOLS[0]!,
    [symbolId],
  );
  const resolution = useMemo(
    () => RESOLUTIONS.find((r) => r.id === resolutionId) ?? RESOLUTIONS[0]!,
    [resolutionId],
  );

  // ---- Raw candle buffer (regenerated on symbol/resolution change) ----
  const rawCandlesRef = useRef<Candle[]>([]);
  const [dataVersion, setDataVersion] = useState(0);

  const renderData = useMemo(() => {
    const raw = generateCandles({
      symbol,
      resolution,
      count: CANDLE_COUNT,
    });
    rawCandlesRef.current = raw;
    return applyTransform(raw, dataTransform, symbol.basePrice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, resolution, dataTransform, dataVersion]);

  // ---- Chart + drawing layer ----
  const chartRef = useRef<OHLCVChartRef>(null);
  const drawingLayerRef = useRef<DrawingLayer>(new DrawingLayer());

  // Attach drawing layer + hover callback on mount.
  useEffect(() => {
    const core = chartRef.current?.chart;
    if (!core) return;
    core.setDrawingLayer(drawingLayerRef.current);
    core.setOnHover((info) => setHover(info));
    core.setChartType(chartType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chartRef.current?.chart?.setChartType(chartType);
  }, [chartType]);

  useEffect(() => {
    const core = chartRef.current?.chart;
    if (!core) return;
    const indicators: Indicator[] = [];
    if (indicatorSet.has('sma20')) indicators.push(new SMA(20));
    if (indicatorSet.has('ema50')) indicators.push(new EMA(50));
    if (indicatorSet.has('bb')) indicators.push(new BollingerBands(20, 2));
    if (indicatorSet.has('vwap')) indicators.push(new VWAP('session'));
    core.setIndicators(indicators);
  }, [indicatorSet]);

  // ---- Live simulation ----
  useEffect(() => {
    if (!live) return;
    let tickIndex = 0;
    const timer = setInterval(() => {
      const core = chartRef.current?.chart;
      const raw = rawCandlesRef.current;
      if (!core || raw.length === 0) return;
      const last = raw[raw.length - 1]!;
      const next = advanceLastCandle({ lastCandle: last, symbol, tickIndex: ++tickIndex });
      raw[raw.length - 1] = next;
      if (dataTransform === 'none') {
        core.updateLastCandle(next);
      } else {
        setDataVersion((v) => v + 1);
      }
    }, LIVE_TICK_MS);
    return () => clearInterval(timer);
  }, [live, symbol, dataTransform]);

  // Stop live when switching symbol/resolution
  useEffect(() => {
    if (live) setLive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolId, resolutionId]);

  // ---- Click → drawing tool dispatch ----
  const onChartClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (activeTool === 'none') return;
      const core = chartRef.current?.chart;
      if (!core) return;
      const target = e.currentTarget;
      const canvases = target.querySelectorAll('canvas');
      const topCanvas = canvases[canvases.length - 1];
      if (!(topCanvas instanceof HTMLCanvasElement)) return;
      const rect = topCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const viewport = core.getViewport();
      const layout = viewport.layout;
      if (
        x < layout.chartLeft ||
        x > layout.chartRight ||
        y < layout.chartTop ||
        y > layout.chartBottom
      )
        return;
      const index = viewport.xToIndex(x);
      const price = viewport.yToPrice(y);
      const layer = drawingLayerRef.current;
      if (!layer.active) {
        if (activeTool === 'trendline') layer.startDrawing(new TrendLine());
        else if (activeTool === 'hline') layer.startDrawing(new HorizontalLine());
      }
      layer.addPoint({ index, price });
      core.render();
    },
    [activeTool],
  );

  // Keyboard shortcuts for drawing tools
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === 't' || e.key === 'T') setActiveTool('trendline');
      else if (e.key === 'h' || e.key === 'H') setActiveTool('hline');
      else if (e.key === 'Escape') setActiveTool('none');
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    drawingLayerRef.current.cancelActive();
    chartRef.current?.chart?.render();
  }, [activeTool]);

  // Close indicator menu when clicking outside
  useEffect(() => {
    if (!indicatorMenuOpen) return;
    const handler = () => setIndicatorMenuOpen(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [indicatorMenuOpen]);

  // ---- Handlers ----
  const onThemeToggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.style.colorScheme = next;
  };

  const onClearDrawings = () => {
    const layer = drawingLayerRef.current;
    layer.clear();
    layer.cancelActive();
    chartRef.current?.chart?.render();
  };

  const onExportPng = () => {
    const core = chartRef.current?.chart;
    if (!core) return;
    const url = core.toPNG();
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = `${symbolId}-${resolutionId}-${Date.now()}.png`;
    link.click();
  };

  const toggleIndicator = (id: IndicatorId) => {
    setIndicatorSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <button
          className={activeTool === 'none' ? 'active' : ''}
          title="Select / no tool (Esc)"
          onClick={() => setActiveTool('none')}
        >
          ✋
        </button>
        <button
          className={activeTool === 'trendline' ? 'active' : ''}
          title="Trend line (T)"
          onClick={() => setActiveTool('trendline')}
        >
          ╱
        </button>
        <button
          className={activeTool === 'hline' ? 'active' : ''}
          title="Horizontal line (H)"
          onClick={() => setActiveTool('hline')}
        >
          ━
        </button>
        <div className="spacer" />
        <button title="Clear all drawings" onClick={onClearDrawings}>
          🗑
        </button>
        <button title="Export chart as PNG" onClick={onExportPng}>
          📷
        </button>
      </aside>

      <header className="toolbar">
        <label>Symbol</label>
        <select value={symbolId} onChange={(e) => setSymbolId(e.target.value)}>
          {SYMBOLS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>

        <label>TF</label>
        <select value={resolutionId} onChange={(e) => setResolutionId(e.target.value)}>
          {RESOLUTIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id}
            </option>
          ))}
        </select>

        <label>Type</label>
        <select value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)}>
          <option value="candles">Candles</option>
          <option value="line">Line</option>
          <option value="area">Area</option>
          <option value="ohlc">OHLC Bars</option>
        </select>

        <label>Data</label>
        <select
          value={dataTransform}
          onChange={(e) => setDataTransform(e.target.value as DataTransform)}
        >
          <option value="none">Raw</option>
          <option value="heikin-ashi">Heikin Ashi</option>
          <option value="renko">Renko</option>
        </select>

        <div className="indicator-menu">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIndicatorMenuOpen((v) => !v);
            }}
          >
            Indicators ▾
          </button>
          {indicatorMenuOpen && (
            <div className="indicator-dropdown" onClick={(e) => e.stopPropagation()}>
              <label>
                <input
                  type="checkbox"
                  checked={indicatorSet.has('sma20')}
                  onChange={() => toggleIndicator('sma20')}
                />{' '}
                SMA(20)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={indicatorSet.has('ema50')}
                  onChange={() => toggleIndicator('ema50')}
                />{' '}
                EMA(50)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={indicatorSet.has('bb')}
                  onChange={() => toggleIndicator('bb')}
                />{' '}
                Bollinger Bands
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={indicatorSet.has('vwap')}
                  onChange={() => toggleIndicator('vwap')}
                />{' '}
                VWAP (session)
              </label>
            </div>
          )}
        </div>

        <button onClick={onThemeToggle}>{theme === 'dark' ? '🌙' : '☀'}</button>
        <button className={live ? 'active' : ''} onClick={() => setLive((v) => !v)}>
          {live ? '■ Stop' : '▶ Live'}
        </button>

        <span className="spacer" />
        <span className="symbol-label">
          {symbol.label} · {resolution.id}
        </span>
      </header>

      <div className="chart-wrap" onClick={onChartClick}>
        <OHLCVChart
          ref={chartRef}
          symbol={symbol.label}
          resolution={resolution.id}
          data={renderData}
          theme={theme}
        />
      </div>

      <footer className="status-bar">
        <StatusOhlc info={hover} resolutionId={resolution.id} />
        <span className="hint">
          Drag pan · Wheel zoom · ←→ keys · T trend · H hline · Esc cancel · Dbl-click fit
        </span>
      </footer>
    </div>
  );
}

function StatusOhlc({
  info,
  resolutionId,
}: {
  info: HoverInfo | null;
  resolutionId: string;
}) {
  if (!info) return <span>Hover chart to see OHLCV</span>;
  const { candle, index } = info;
  const bull = candle.c >= candle.o;
  const cls = bull ? 'bull' : 'bear';
  const change = candle.c - candle.o;
  const changePct = (change / candle.o) * 100;
  return (
    <span>
      <span className={cls}>#{index}</span>
      {'  '}
      {formatTime(candle.t, resolutionId)}
      {'   '}
      O <b>{formatPrice(candle.o)}</b>
      {'  '}H <b>{formatPrice(candle.h)}</b>
      {'  '}L <b>{formatPrice(candle.l)}</b>
      {'  '}C <b>{formatPrice(candle.c)}</b>
      {'  '}V <b>{Math.round(candle.v).toLocaleString()}</b>
      {'   '}
      <span className={cls}>
        {change >= 0 ? '+' : ''}
        {change.toFixed(2)} ({changePct >= 0 ? '+' : ''}
        {changePct.toFixed(2)}%)
      </span>
    </span>
  );
}

function applyTransform(
  raw: Candle[],
  transform: DataTransform,
  basePrice: number,
): Candle[] {
  if (transform === 'heikin-ashi') return toHeikinAshi(raw);
  if (transform === 'renko') {
    const brickSize = Math.max(0.01, basePrice * RENKO_BRICK_RATIO);
    const bricks = toRenko(raw, brickSize);
    return bricks.length > 0 ? bricks : raw;
  }
  return raw;
}
