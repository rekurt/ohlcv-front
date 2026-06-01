import {
  OHLCVChart,
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
  type Indicator,
  type ThemeMode,
  type HoverInfo,
} from '@rekurt/ohlcv-core';
import {
  SYMBOLS,
  RESOLUTIONS,
  generateCandles,
  advanceLastCandle,
  type SymbolInfo,
  type ResolutionInfo,
} from '@ohlcv-examples/shared';

type DrawingTool = 'none' | 'trendline' | 'hline';
type DataTransform = 'none' | 'heikin-ashi' | 'renko';

const CANDLE_COUNT = 500;
const LIVE_TICK_MS = 500;
const RENKO_BRICK_RATIO = 0.001; // 0.1% of base price per brick

// ---- State ----
let currentSymbol: SymbolInfo = SYMBOLS[0]!;
let currentResolution: ResolutionInfo =
  RESOLUTIONS.find((r) => r.id === '1H') ?? RESOLUTIONS[0]!;
let theme: ThemeMode = 'dark';
let chartType: ChartType = 'candles';
let dataTransform: DataTransform = 'none';
let liveTimer: ReturnType<typeof setInterval> | null = null;
let liveTickIndex = 0;
let rawCandles: Candle[] = [];
let renderCandles: Candle[] = []; // raw, heikin-ashi, or renko
let activeTool: DrawingTool = 'none';
const enabledIndicators = new Set<string>();

// ---- DOM ----
const container = document.getElementById('chart') as HTMLDivElement;
const symbolSelect = document.getElementById('symbol-select') as HTMLSelectElement;
const resolutionSelect = document.getElementById('resolution-select') as HTMLSelectElement;
const chartTypeSelect = document.getElementById('chart-type-select') as HTMLSelectElement;
const dataTransformSelect = document.getElementById('data-transform-select') as HTMLSelectElement;
const themeBtn = document.getElementById('theme-btn') as HTMLButtonElement;
const liveBtn = document.getElementById('live-btn') as HTMLButtonElement;
const symbolLabel = document.getElementById('symbol-label') as HTMLSpanElement;
const statusOhlc = document.getElementById('status-ohlc') as HTMLSpanElement;
const indicatorMenu = document.getElementById('indicator-menu') as HTMLDivElement;
const indicatorToggle = document.getElementById('indicator-toggle') as HTMLButtonElement;
const indicatorDropdown = document.getElementById('indicator-dropdown') as HTMLDivElement;
const indicatorChecks = indicatorDropdown.querySelectorAll<HTMLInputElement>('input[data-ind]');
const sidebarButtons = document.querySelectorAll<HTMLButtonElement>('#sidebar button[data-tool]');
const clearDrawingsBtn = document.getElementById('clear-drawings') as HTMLButtonElement;
const exportPngBtn = document.getElementById('export-png') as HTMLButtonElement;

// Populate selects
for (const s of SYMBOLS) {
  const opt = document.createElement('option');
  opt.value = s.id;
  opt.textContent = s.label;
  symbolSelect.appendChild(opt);
}
for (const r of RESOLUTIONS) {
  const opt = document.createElement('option');
  opt.value = r.id;
  opt.textContent = r.id;
  if (r.id === currentResolution.id) opt.selected = true;
  resolutionSelect.appendChild(opt);
}

// ---- Drawing layer (owned by the example, attached to the engine) ----
const drawingLayer = new DrawingLayer();

// ---- Chart ----
const chart = new OHLCVChart({
  container,
  symbol: currentSymbol.label,
  resolution: currentResolution.id,
  theme,
  chartType,
  onCandleClick: (candle, index) => {
    renderStatus({
      candle,
      index,
      cursorPrice: candle.c,
      timeLabel: formatTime(candle.t, currentResolution.id),
      paneIndex: 0,
      hovered: null,
    });
  },
  onHover: (info) => renderStatus(info),
});
chart.setDrawingLayer(drawingLayer);
symbolLabel.textContent = `${currentSymbol.label} · ${currentResolution.id}`;

// ---- Data pipeline ----
function recomputeRenderCandles(): void {
  if (dataTransform === 'heikin-ashi') {
    renderCandles = toHeikinAshi(rawCandles);
  } else if (dataTransform === 'renko') {
    const brickSize = Math.max(0.01, currentSymbol.basePrice * RENKO_BRICK_RATIO);
    renderCandles = toRenko(rawCandles, brickSize);
    if (renderCandles.length === 0) renderCandles = rawCandles;
  } else {
    renderCandles = rawCandles;
  }
  chart.setData(renderCandles);
}

function reloadData(): void {
  rawCandles = generateCandles({
    symbol: currentSymbol,
    resolution: currentResolution,
    count: CANDLE_COUNT,
  });
  recomputeRenderCandles();
}
reloadData();

// ---- Indicators ----
function buildIndicators(): Indicator[] {
  const list: Indicator[] = [];
  if (enabledIndicators.has('sma20')) list.push(new SMA(20));
  if (enabledIndicators.has('ema50')) list.push(new EMA(50));
  if (enabledIndicators.has('bb')) list.push(new BollingerBands(20, 2));
  if (enabledIndicators.has('vwap')) list.push(new VWAP('session'));
  return list;
}
chart.setIndicators(buildIndicators());

// ---- Status bar (safe DOM, no innerHTML) ----
function renderStatus(info: HoverInfo | null): void {
  // Wipe existing children — safe, no user-provided HTML used anywhere.
  while (statusOhlc.firstChild) statusOhlc.removeChild(statusOhlc.firstChild);
  if (!info) {
    statusOhlc.textContent = 'Hover chart to see OHLCV';
    return;
  }
  const { candle, index } = info;
  const bull = candle.c >= candle.o;
  const cls = bull ? 'bull' : 'bear';
  const change = candle.c - candle.o;
  const changePct = (change / candle.o) * 100;

  const appendLabelValue = (label: string, value: string, color?: 'bull' | 'bear') => {
    const labelSpan = document.createElement('span');
    labelSpan.textContent = ` ${label} `;
    const valueStrong = document.createElement('b');
    valueStrong.textContent = value;
    if (color) valueStrong.className = color;
    statusOhlc.appendChild(labelSpan);
    statusOhlc.appendChild(valueStrong);
  };

  const idxSpan = document.createElement('span');
  idxSpan.className = cls;
  idxSpan.textContent = `#${index}`;
  statusOhlc.appendChild(idxSpan);

  const timeSpan = document.createElement('span');
  timeSpan.textContent = `  ${formatTime(candle.t, currentResolution.id)}  `;
  statusOhlc.appendChild(timeSpan);

  appendLabelValue('O', formatPrice(candle.o));
  appendLabelValue('H', formatPrice(candle.h));
  appendLabelValue('L', formatPrice(candle.l));
  appendLabelValue('C', formatPrice(candle.c));
  appendLabelValue('V', Math.round(candle.v).toLocaleString());

  const changeSpan = document.createElement('span');
  changeSpan.className = cls;
  changeSpan.textContent = `   ${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`;
  statusOhlc.appendChild(changeSpan);
}

// ---- Toolbar handlers ----
symbolSelect.addEventListener('change', () => {
  const next = SYMBOLS.find((s) => s.id === symbolSelect.value);
  if (!next) return;
  currentSymbol = next;
  chart.switchSymbol(next.label, currentResolution.id);
  symbolLabel.textContent = `${next.label} · ${currentResolution.id}`;
  reloadData();
});

resolutionSelect.addEventListener('change', () => {
  const next = RESOLUTIONS.find((r) => r.id === resolutionSelect.value);
  if (!next) return;
  currentResolution = next;
  chart.switchSymbol(currentSymbol.label, next.id);
  symbolLabel.textContent = `${currentSymbol.label} · ${next.id}`;
  reloadData();
});

chartTypeSelect.addEventListener('change', () => {
  chartType = chartTypeSelect.value as ChartType;
  chart.setChartType(chartType);
});

dataTransformSelect.addEventListener('change', () => {
  dataTransform = dataTransformSelect.value as DataTransform;
  recomputeRenderCandles();
});

themeBtn.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  chart.setTheme(theme);
  themeBtn.textContent = theme === 'dark' ? '🌙' : '☀';
  document.documentElement.style.colorScheme = theme;
});

liveBtn.addEventListener('click', () => {
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
    liveBtn.classList.remove('active');
    liveBtn.textContent = '▶ Live';
    return;
  }
  liveTimer = setInterval(() => {
    if (rawCandles.length === 0) return;
    const last = rawCandles[rawCandles.length - 1]!;
    const next = advanceLastCandle({
      lastCandle: last,
      symbol: currentSymbol,
      tickIndex: ++liveTickIndex,
    });
    rawCandles[rawCandles.length - 1] = next;
    if (dataTransform === 'none') {
      chart.updateLastCandle(next);
    } else {
      // Heikin Ashi / Renko require full recompute on every tick.
      recomputeRenderCandles();
    }
  }, LIVE_TICK_MS);
  liveBtn.classList.add('active');
  liveBtn.textContent = '■ Stop';
});

// ---- Indicator dropdown ----
indicatorToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  indicatorMenu.classList.toggle('open');
});
document.addEventListener('click', () => indicatorMenu.classList.remove('open'));
indicatorDropdown.addEventListener('click', (e) => e.stopPropagation());
for (const check of indicatorChecks) {
  check.addEventListener('change', () => {
    const id = check.dataset['ind']!;
    if (check.checked) enabledIndicators.add(id);
    else enabledIndicators.delete(id);
    chart.setIndicators(buildIndicators());
  });
}

// ---- Sidebar: drawing tools ----
function setActiveTool(tool: DrawingTool): void {
  activeTool = tool;
  for (const btn of sidebarButtons) {
    btn.classList.toggle('active', btn.dataset['tool'] === tool);
  }
  drawingLayer.cancelActive();
  chart.render();
}
for (const btn of sidebarButtons) {
  btn.addEventListener('click', () => {
    setActiveTool(btn.dataset['tool'] as DrawingTool);
  });
}

clearDrawingsBtn.addEventListener('click', () => {
  drawingLayer.clear();
  drawingLayer.cancelActive();
  chart.render();
});

exportPngBtn.addEventListener('click', () => {
  const dataUrl = chart.toPNG();
  if (!dataUrl) {
    alert('PNG export not available');
    return;
  }
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `${currentSymbol.id}-${currentResolution.id}-${Date.now()}.png`;
  link.click();
});

// ---- Chart-area click: feed into active drawing tool ----
container.addEventListener(
  'click',
  (e) => {
    if (activeTool === 'none') return;
    const canvases = container.querySelectorAll('canvas');
    const topCanvas = canvases[canvases.length - 1];
    if (!topCanvas || !(topCanvas instanceof HTMLCanvasElement)) return;
    const rect = topCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const layout = chart.getViewport().layout;
    if (
      x < layout.chartLeft ||
      x > layout.chartRight ||
      y < layout.chartTop ||
      y > layout.chartBottom
    )
      return;
    const viewport = chart.getViewport();
    const index = viewport.xToIndex(x);
    const price = viewport.yToPrice(y);

    if (!drawingLayer.active) {
      if (activeTool === 'trendline') drawingLayer.startDrawing(new TrendLine());
      else if (activeTool === 'hline') drawingLayer.startDrawing(new HorizontalLine());
    }
    drawingLayer.addPoint({ index, price });
    chart.render();
  },
  true,
);

// Keyboard shortcuts for tools
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.key === 't' || e.key === 'T') setActiveTool('trendline');
  else if (e.key === 'h' || e.key === 'H') setActiveTool('hline');
  else if (e.key === 'Escape') setActiveTool('none');
});

// ---- Cleanup ----
window.addEventListener('beforeunload', () => {
  if (liveTimer) clearInterval(liveTimer);
  chart.destroy();
});
