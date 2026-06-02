import { describe, it, expect, beforeAll } from 'vitest';
import { SVGRenderingContext } from './svgContext';
import { chartEngineToSVG } from './toSVG';
import { ChartEngine } from '../rendering/ChartEngine';
import { CandleBuffer } from '../data/CandleBuffer';
import { DARK_THEME } from '../constants';
import { installCanvasStub } from '../test-utils/canvasStub';
import type { Candle } from '../types';

// --- Unit tests for the SVG recording context -----------------------------

describe('SVGRenderingContext', () => {
  it('emits a <rect> for fillRect with the current fillStyle', () => {
    const ctx = new SVGRenderingContext();
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(10, 20, 30, 40);
    const svg = ctx.toSVG(100, 100);
    expect(svg).toContain('<rect');
    expect(svg).toContain('x="10"');
    expect(svg).toContain('y="20"');
    expect(svg).toContain('width="30"');
    expect(svg).toContain('height="40"');
    expect(svg).toContain('fill="#ff0000"');
  });

  it('emits a <path d=...> for beginPath + lineTo + stroke', () => {
    const ctx = new SVGRenderingContext();
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(10, 10);
    ctx.lineTo(20, 0);
    ctx.stroke();
    const svg = ctx.toSVG(100, 100);
    expect(svg).toMatch(/<path d="M0 0L10 10L20 0"/);
    expect(svg).toContain('stroke="#00ff00"');
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('fill="none"');
  });

  it('emits a separate filled <path> on fill()', () => {
    const ctx = new SVGRenderingContext();
    ctx.fillStyle = '#123456';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(5, 0);
    ctx.lineTo(5, 5);
    ctx.closePath();
    ctx.fill();
    const svg = ctx.toSVG(50, 50);
    expect(svg).toMatch(/<path d="M0 0L5 0L5 5Z"[^>]*fill="#123456"/);
  });

  it('save/restore restores the prior style', () => {
    const ctx = new SVGRenderingContext();
    ctx.fillStyle = '#aaaaaa';
    ctx.save();
    ctx.fillStyle = '#bbbbbb';
    ctx.fillRect(0, 0, 1, 1); // bbbbbb
    ctx.restore();
    expect(ctx.fillStyle).toBe('#aaaaaa');
    ctx.fillRect(2, 2, 1, 1); // aaaaaa again
    const svg = ctx.toSVG(10, 10);
    expect(svg).toContain('fill="#bbbbbb"');
    expect(svg).toContain('fill="#aaaaaa"');
  });

  it('emits a <text> with content, font-size and anchor for fillText', () => {
    const ctx = new SVGRenderingContext();
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#222';
    ctx.fillText('BTC/USDT', 40, 12);
    const svg = ctx.toSVG(100, 50);
    expect(svg).toContain('<text');
    expect(svg).toContain('>BTC/USDT</text>');
    expect(svg).toContain('font-size="14"');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('font-weight="bold"');
  });

  it('escapes XML-special characters in text', () => {
    const ctx = new SVGRenderingContext();
    ctx.fillText('a < b & "c"', 0, 10);
    const svg = ctx.toSVG(50, 50);
    expect(svg).toContain('a &lt; b &amp; &quot;c&quot;');
    expect(svg).not.toContain('a < b & "c"');
  });

  it('clip() scopes subsequent elements to a <clipPath> until restore()', () => {
    const ctx = new SVGRenderingContext();
    ctx.save();
    ctx.beginPath();
    ctx.rect(10, 10, 80, 80);
    ctx.clip();
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 100, 100); // clipped
    ctx.restore();
    ctx.fillRect(0, 0, 5, 5); // unclipped
    const svg = ctx.toSVG(100, 100);
    expect(svg).toContain('<clipPath id="clip0">');
    // The clipped rect references the clip; the post-restore rect does not.
    const clippedCount = (svg.match(/clip-path="url\(#clip0\)"/g) ?? []).length;
    expect(clippedCount).toBe(1);
  });

  it('setLineDash renders as stroke-dasharray', () => {
    const ctx = new SVGRenderingContext();
    ctx.setLineDash([4, 2]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(10, 0);
    ctx.stroke();
    const svg = ctx.toSVG(20, 20);
    expect(svg).toContain('stroke-dasharray="4,2"');
  });

  it('createLinearGradient registers a <linearGradient> in <defs> and is referenced', () => {
    const ctx = new SVGRenderingContext();
    const g = ctx.createLinearGradient(0, 0, 0, 100);
    g.addColorStop(0, '#ff0000');
    g.addColorStop(1, '#0000ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 100, 100);
    const svg = ctx.toSVG(100, 100);
    expect(svg).toContain('<defs>');
    expect(svg).toContain('<linearGradient id="grad0"');
    expect(svg).toContain('stop-color="#ff0000"');
    expect(svg).toContain('fill="url(#grad0)"');
  });

  it('globalAlpha renders as fill-opacity', () => {
    const ctx = new SVGRenderingContext();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 10, 10);
    const svg = ctx.toSVG(10, 10);
    expect(svg).toContain('fill-opacity="0.5"');
  });

  it('measureText returns a positive width that scales with text length', () => {
    const ctx = new SVGRenderingContext();
    ctx.font = '12px sans-serif';
    const a = ctx.measureText('x').width;
    const b = ctx.measureText('xxxxxxxxxx').width;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
  });

  it('toSVG wraps content in a sized <svg> with a background rect', () => {
    const ctx = new SVGRenderingContext();
    const svg = ctx.toSVG(640, 480, '#101010');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('width="640"');
    expect(svg).toContain('height="480"');
    expect(svg).toContain('viewBox="0 0 640 480"');
    expect(svg).toContain('fill="#101010"');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('unimplemented calls are harmless no-ops (drawImage/scale/clearRect)', () => {
    const ctx = new SVGRenderingContext();
    expect(() => {
      ctx.scale(2, 2);
      ctx.drawImage({}, 0, 0);
      ctx.clearRect(0, 0, 10, 10);
    }).not.toThrow();
  });
});

// --- Integration: render a real ChartEngine through the SVG sink ----------

function makeCandle(i: number): Candle {
  const c = 100 + Math.sin(i / 4) * 8 + i * 0.05;
  const o = 100 + Math.sin((i - 1) / 4) * 8 + (i - 1) * 0.05;
  const h = Math.max(o, c) + 1.5;
  const l = Math.min(o, c) - 1.5;
  return { o, h, l, c, v: 1000 + (i % 7) * 120, t: 1_700_000_000 + i * 3600 };
}

function buildChart(): ChartEngine {
  const container = document.createElement('div');
  container.getBoundingClientRect = () =>
    ({ width: 1000, height: 500, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, toJSON() {} }) as DOMRect;
  document.body.appendChild(container);
  const engine = new ChartEngine(container, DARK_THEME);
  engine.setSymbol('BTC/USDT');
  engine.setResolution('1H');
  const buffer = new CandleBuffer();
  for (let i = 0; i < 60; i++) buffer.append(makeCandle(i));
  engine.setBuffer(buffer);
  engine.viewport.scrollToEnd(buffer.length);
  return engine;
}

describe('chartEngineToSVG', () => {
  beforeAll(() => {
    installCanvasStub();
  });

  it('returns a valid <svg> string with non-empty drawn elements', () => {
    const engine = buildChart();
    const svg = chartEngineToSVG(engine);
    engine.destroy();

    expect(typeof svg).toBe('string');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
    // The chart layer must have drawn real geometry + text.
    expect(svg).toContain('<rect'); // background + candle bodies / volume
    expect(svg).toContain('<path'); // grid lines / wicks / axes ticks
    expect(svg).toContain('<text'); // axis + time labels
  });

  it('embeds the theme background as a full-bleed rect', () => {
    const engine = buildChart();
    const svg = chartEngineToSVG(engine);
    engine.destroy();
    expect(svg).toContain(`fill="${DARK_THEME.background}"`);
    expect(svg).toContain('viewBox="0 0 1000 500"');
  });

  it('produces well-formed XML (parses without a parser error)', () => {
    const engine = buildChart();
    const svg = chartEngineToSVG(engine);
    engine.destroy();

    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const parserError = doc.querySelector('parsererror');
    expect(parserError).toBeNull();
    expect(doc.documentElement.nodeName.toLowerCase()).toBe('svg');
  });

  it('does not throw and returns an empty-ish <svg> when no buffer is set', () => {
    const container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({ width: 400, height: 300, x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 300, toJSON() {} }) as DOMRect;
    document.body.appendChild(container);
    const engine = new ChartEngine(container, DARK_THEME);
    let svg = '';
    expect(() => {
      svg = chartEngineToSVG(engine);
    }).not.toThrow();
    engine.destroy();
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
  });
});
