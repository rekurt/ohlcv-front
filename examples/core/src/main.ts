import { OHLCVChart, formatPrice, formatTime, type Candle, type ThemeMode } from '@ohlcv/core';
import {
  SYMBOLS,
  RESOLUTIONS,
  generateCandles,
  advanceLastCandle,
  type SymbolInfo,
  type ResolutionInfo,
} from '@ohlcv-examples/shared';

const CANDLE_COUNT = 500;
const LIVE_TICK_MS = 500;

// ---- State ----
let currentSymbol: SymbolInfo = SYMBOLS[0];
let currentResolution: ResolutionInfo = RESOLUTIONS.find((r) => r.id === '1H') ?? RESOLUTIONS[0];
let theme: ThemeMode = 'dark';
let liveTimer: ReturnType<typeof setInterval> | null = null;
let liveTickIndex = 0;
let candles: Candle[] = [];

// ---- DOM ----
const container = document.getElementById('chart') as HTMLDivElement;
const symbolSelect = document.getElementById('symbol-select') as HTMLSelectElement;
const resolutionSelect = document.getElementById('resolution-select') as HTMLSelectElement;
const themeBtn = document.getElementById('theme-btn') as HTMLButtonElement;
const liveBtn = document.getElementById('live-btn') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;

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

// ---- Chart ----
const chart = new OHLCVChart({
  container,
  symbol: currentSymbol.label,
  resolution: currentResolution.id,
  theme,
  onCandleClick: (candle, index) => {
    statusEl.textContent =
      `#${index}  ${formatTime(candle.t, currentResolution.id)}  ` +
      `O ${formatPrice(candle.o)}  H ${formatPrice(candle.h)}  ` +
      `L ${formatPrice(candle.l)}  C ${formatPrice(candle.c)}  ` +
      `V ${Math.round(candle.v)}`;
  },
  // onVisibleRangeChange: (from, to) => { /* hook here if needed — too noisy for default demo */ },
});

function reloadData(): void {
  candles = generateCandles({ symbol: currentSymbol, resolution: currentResolution, count: CANDLE_COUNT });
  chart.setData(candles);
}
reloadData();

// ---- Handlers ----
symbolSelect.addEventListener('change', () => {
  const next = SYMBOLS.find((s) => s.id === symbolSelect.value);
  if (!next) return;
  currentSymbol = next;
  chart.switchSymbol(next.label, currentResolution.id);
  reloadData();
});

resolutionSelect.addEventListener('change', () => {
  const next = RESOLUTIONS.find((r) => r.id === resolutionSelect.value);
  if (!next) return;
  currentResolution = next;
  chart.switchSymbol(currentSymbol.label, next.id);
  reloadData();
});

themeBtn.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  chart.setTheme(theme);
  themeBtn.textContent = theme === 'dark' ? '🌙 Dark' : '☀ Light';
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
    if (candles.length === 0) return;
    const last = candles[candles.length - 1];
    const next = advanceLastCandle({ lastCandle: last, symbol: currentSymbol, tickIndex: ++liveTickIndex });
    candles[candles.length - 1] = next;
    chart.updateLastCandle(next);
  }, LIVE_TICK_MS);
  liveBtn.classList.add('active');
  liveBtn.textContent = '■ Stop';
});

// ---- Cleanup ----
window.addEventListener('beforeunload', () => {
  if (liveTimer) clearInterval(liveTimer);
  chart.destroy();
});
