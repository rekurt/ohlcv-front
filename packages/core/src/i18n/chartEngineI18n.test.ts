import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { ChartEngine } from '../rendering/ChartEngine';
import { CandleBuffer } from '../data/CandleBuffer';
import { DARK_THEME } from '../constants';
import { installCanvasStub } from '../test-utils/canvasStub';
import { createI18n } from './messages';
import type { Candle } from '../types';

function makeCandle(i: number): Candle {
  return { o: 100, h: 101, l: 99, c: 100.5, v: 10, t: 1_700_000_000 + i * 60 };
}

/** Read the off-screen aria-live region's current text. */
function liveText(container: HTMLElement): string {
  const region = container.querySelector('[role="status"]');
  return region?.textContent ?? '';
}

describe('ChartEngine i18n integration', () => {
  let container: HTMLDivElement;
  let engine: ChartEngine;
  let buffer: CandleBuffer;

  beforeAll(() => {
    installCanvasStub();
  });

  beforeEach(() => {
    container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({ width: 1000, height: 500, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, toJSON() {} }) as DOMRect;
    document.body.appendChild(container);
    engine = new ChartEngine(container, DARK_THEME);
    buffer = new CandleBuffer();
    for (let i = 0; i < 10; i++) buffer.append(makeCandle(i));
    engine.setBuffer(buffer);
    engine.setSymbol('BTCUSD');
    engine.setResolution('1H');
  });

  afterEach(() => {
    engine.destroy();
    container.remove();
  });

  it('defaults to the English aria-label', () => {
    expect(engine.topCanvas.getAttribute('aria-label')).toBe(
      'OHLCV price chart. Use arrow keys to pan, plus and minus to zoom, Home and End to jump.',
    );
  });

  it('localizes the aria-label from the message bundle', () => {
    engine.setI18n(
      createI18n('ru-RU', {
        a11yChartLabel: 'График цен OHLCV.',
        a11yChartHint: 'Стрелки — прокрутка, плюс/минус — масштаб.',
      }),
    );
    expect(engine.topCanvas.getAttribute('aria-label')).toBe(
      'График цен OHLCV. Стрелки — прокрутка, плюс/минус — масштаб.',
    );
  });

  it('uses the message words in the OHLC crosshair announcement', () => {
    const candle = buffer.candleAt(5)!;
    engine.setCrosshair(100, 100, 5, candle, '12:00');
    const def = liveText(container);
    // Default English words present.
    expect(def).toContain('open');
    expect(def).toContain('high');
    expect(def).toContain('low');
    expect(def).toContain('close');
    expect(def).toContain('BTCUSD');
  });

  it('changing messages changes the announcement words', () => {
    const candle = buffer.candleAt(5)!;
    engine.setCrosshair(100, 100, 5, candle, '12:00');
    const before = liveText(container);
    expect(before).toContain('open');

    engine.setI18n(
      createI18n(undefined, {
        a11yOpen: 'откр',
        a11yHigh: 'макс',
        a11yLow: 'мин',
        a11yClose: 'закр',
      }),
    );
    // Move to a different candle so the dedupe guard doesn't suppress the update.
    const candle6 = buffer.candleAt(6)!;
    engine.setCrosshair(120, 100, 6, candle6, '13:00');
    const after = liveText(container);
    expect(after).toContain('откр');
    expect(after).toContain('макс');
    expect(after).toContain('мин');
    expect(after).toContain('закр');
    expect(after).not.toContain('open');
  });

  it('locale-aware announcement still works and prefers a host price formatter', () => {
    // Host formatter wins over the locale formatter for the OHLC numbers.
    engine.setPriceFormat((p) => `$${p.toFixed(1)}`);
    const candle = buffer.candleAt(5)!;
    engine.setCrosshair(100, 100, 5, candle, '12:00');
    expect(liveText(container)).toContain('$100.5');
  });

  it('exposes the active i18n bundle', () => {
    const i18n = createI18n('de-DE');
    engine.setI18n(i18n);
    expect(engine.i18n).toBe(i18n);
    expect(engine.i18n.locale).toBe('de-DE');
  });

  it('localizes time-axis labels via the time scale when a locale is set', () => {
    engine.setResolution('1D');
    engine.setI18n(createI18n('en-US'));
    // The default time scale now carries a date formatter → daily label
    // formatted via Intl ("Jan 15"-style) rather than the legacy "15 Jan".
    const ts = 1705329000; // 2024-01-15
    const label = engine.horzScale.formatValue(ts);
    expect(label).toMatch(/Jan/);
    expect(label).toMatch(/15/);
  });

  it('clears the date formatter when reset to no-locale (legacy labels)', () => {
    engine.setResolution('1D');
    engine.setI18n(createI18n('en-US'));
    engine.setI18n(createI18n()); // back to default
    const ts = 1705329000;
    // Legacy formatTime output for 1D is "15 Jan".
    expect(engine.horzScale.formatValue(ts)).toBe('15 Jan');
  });
});
