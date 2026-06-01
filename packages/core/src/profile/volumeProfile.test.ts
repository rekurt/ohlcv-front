import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { ChartEngine } from '../rendering/ChartEngine';
import { CandleBuffer } from '../data/CandleBuffer';
import { DARK_THEME } from '../constants';
import { installCanvasStub } from '../test-utils/canvasStub';
import { Viewport } from '../interaction/Viewport';
import { computeLayout } from '../utils';
import type { Candle, CandleView, ChartLayout } from '../types';
import type { Primitive } from '../primitives/Primitive';
import { computeVolumeProfile } from './computeVolumeProfile';
import { VolumeProfilePrimitive } from './VolumeProfilePrimitive';
import { VolumeProfileController, type VolumeProfileHost } from './VolumeProfileController';

const BASE_T = 1_700_000_000;
const STEP = 60;

function makeCandle(i: number, override?: Partial<Candle>): Candle {
  const c = 100 + Math.sin(i / 3) * 5;
  return { o: c, h: c + 1, l: c - 1, c, v: 10 + i, t: BASE_T + i * STEP, ...override };
}

function makeBuffer(n: number): CandleBuffer {
  const buf = new CandleBuffer();
  for (let i = 0; i < n; i++) buf.append(makeCandle(i));
  return buf;
}

/** Build a CandleView from explicit OHLCV rows (the binning only reads l/h/v). */
function viewFromRows(rows: { l: number; h: number; v: number }[]): CandleView {
  const n = rows.length;
  const open = new Float64Array(n);
  const high = new Float64Array(n);
  const low = new Float64Array(n);
  const close = new Float64Array(n);
  const volume = new Float64Array(n);
  const time = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    low[i] = rows[i]!.l;
    high[i] = rows[i]!.h;
    volume[i] = rows[i]!.v;
    open[i] = rows[i]!.l;
    close[i] = rows[i]!.h;
    time[i] = BASE_T + i * STEP;
  }
  return { open, high, low, close, volume, time, length: n, offset: 0 };
}

function forceRender(engine: ChartEngine): void {
  (engine as unknown as { _render: () => void })._render();
}

/** Recording 2D-context stub: captures path ops + property sets. */
interface Op {
  type: 'call' | 'set';
  name: string;
  args?: unknown[];
  value?: unknown;
}
function makeCtx(): CanvasRenderingContext2D & { __ops: Op[]; __props: Record<string, unknown> } {
  const ops: Op[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(
    {},
    {
      get(_t, p: string) {
        if (p === '__ops') return ops;
        if (p === '__props') return props;
        if (p === 'measureText') return (t: string) => ({ width: t.length * 6 });
        if (p in props) return props[p];
        return (...args: unknown[]) => {
          ops.push({ type: 'call', name: p, args });
        };
      },
      set(_t, p: string, v: unknown) {
        props[p] = v;
        ops.push({ type: 'set', name: p, value: v });
        return true;
      },
    },
  );
  return ctx as unknown as CanvasRenderingContext2D & { __ops: Op[]; __props: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Pure computeVolumeProfile
// ---------------------------------------------------------------------------
describe('computeVolumeProfile', () => {
  it('conserves total volume across bins (sum of bins == sum of candle volumes)', () => {
    // A spread of candles across [0, 10]; overlapping ranges.
    const view = viewFromRows([
      { l: 0, h: 10, v: 100 }, // spans the whole range
      { l: 2, h: 4, v: 60 },
      { l: 5, h: 5, v: 30 }, // point candle
      { l: 8, h: 9.5, v: 40 },
    ]);
    const profile = computeVolumeProfile(view, 10, 0, 10);
    const expectedTotal = 100 + 60 + 30 + 40;
    expect(profile.totalVolume).toBeCloseTo(expectedTotal, 6);
    const binSum = profile.bins.reduce((acc, b) => acc + b.volume, 0);
    expect(binSum).toBeCloseTo(expectedTotal, 6);
    expect(profile.bins).toHaveLength(10);
  });

  it('splits a candle proportionally across the bins its range overlaps', () => {
    // One candle from 0..10 over 10 unit bins → exactly 1/10 of volume each.
    const view = viewFromRows([{ l: 0, h: 10, v: 100 }]);
    const profile = computeVolumeProfile(view, 10, 0, 10);
    for (const bin of profile.bins) {
      expect(bin.volume).toBeCloseTo(10, 6);
    }
  });

  it('partial overlap distributes by overlap length', () => {
    // Candle 2.5..7.5 over bins of width 1 in [0,10]:
    //   bin[2]=[2,3) → 0.5, bin[3..6] → 1.0 each, bin[7]=[7,8) → 0.5; span=5.
    const view = viewFromRows([{ l: 2.5, h: 7.5, v: 100 }]);
    const profile = computeVolumeProfile(view, 10, 0, 10);
    expect(profile.bins[2]!.volume).toBeCloseTo(100 * (0.5 / 5), 6);
    expect(profile.bins[3]!.volume).toBeCloseTo(100 * (1 / 5), 6);
    expect(profile.bins[6]!.volume).toBeCloseTo(100 * (1 / 5), 6);
    expect(profile.bins[7]!.volume).toBeCloseTo(100 * (0.5 / 5), 6);
    expect(profile.bins[0]!.volume).toBe(0);
    expect(profile.bins[9]!.volume).toBe(0);
  });

  it('puts a point candle (low == high) entirely in one bin', () => {
    const view = viewFromRows([{ l: 5.5, h: 5.5, v: 80 }]);
    const profile = computeVolumeProfile(view, 10, 0, 10);
    // 5.5 → bin index 5 ([5,6)).
    expect(profile.bins[5]!.volume).toBeCloseTo(80, 6);
    expect(profile.pocIndex).toBe(5);
    const others = profile.bins.filter((_, i) => i !== 5).reduce((a, b) => a + b.volume, 0);
    expect(others).toBe(0);
  });

  it('finds the POC where volume concentrates in a narrow price band', () => {
    // Lots of candles parked tightly around price 30 (bin 6 of [0,50]/10-wide=5).
    const rows = [
      { l: 0, h: 50, v: 5 }, // thin background spread
      { l: 29, h: 31, v: 200 },
      { l: 29.5, h: 30.5, v: 300 },
      { l: 28, h: 32, v: 150 },
    ];
    const view = viewFromRows(rows);
    const profile = computeVolumeProfile(view, 10, 0, 50);
    const poc = profile.bins[profile.pocIndex]!;
    // POC bin must contain price 30.
    expect(poc.priceLow).toBeLessThanOrEqual(30);
    expect(poc.priceHigh).toBeGreaterThanOrEqual(30);
  });

  it('value area covers at least the requested fraction of total volume', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      l: i,
      h: i + 1,
      v: 50 + (i === 10 ? 500 : 0), // a big POC spike at price ~10
    }));
    const view = viewFromRows(rows);
    const profile = computeVolumeProfile(view, 20, 0, 20, { valueAreaPct: 0.7 });
    // Sum the bins inside [valueAreaLow, valueAreaHigh].
    let vaVolume = 0;
    for (const bin of profile.bins) {
      const mid = (bin.priceLow + bin.priceHigh) / 2;
      if (mid >= profile.valueAreaLow && mid <= profile.valueAreaHigh) vaVolume += bin.volume;
    }
    expect(vaVolume).toBeGreaterThanOrEqual(0.7 * profile.totalVolume - 1e-6);
    expect(profile.valueAreaHigh).toBeGreaterThan(profile.valueAreaLow);
  });

  it('value area pct defaults to 0.70 and clamps out-of-range input', () => {
    const view = viewFromRows([
      { l: 0, h: 1, v: 10 },
      { l: 1, h: 2, v: 90 },
      { l: 2, h: 3, v: 10 },
    ]);
    const def = computeVolumeProfile(view, 3, 0, 3);
    // POC is the middle bin (vol 90 of 110 ≈ 82% > 70%) → VA == just the POC bin.
    expect(def.pocIndex).toBe(1);
    expect(def.valueAreaLow).toBeCloseTo(1, 6);
    expect(def.valueAreaHigh).toBeCloseTo(2, 6);
    // pct > 1 clamps to 1 → VA spans every non-empty bin.
    const full = computeVolumeProfile(view, 3, 0, 3, { valueAreaPct: 5 });
    expect(full.valueAreaLow).toBeCloseTo(0, 6);
    expect(full.valueAreaHigh).toBeCloseTo(3, 6);
  });

  it('is NaN-safe: skips candles with non-finite low/high/volume', () => {
    const view = viewFromRows([
      { l: 2, h: 4, v: 50 },
      { l: NaN, h: 4, v: 50 },
      { l: 2, h: Infinity, v: 50 },
      { l: 2, h: 4, v: NaN },
      { l: 2, h: 4, v: -10 }, // non-positive volume skipped
    ]);
    const profile = computeVolumeProfile(view, 10, 0, 10);
    expect(profile.totalVolume).toBeCloseTo(50, 6);
    expect(Number.isFinite(profile.valueAreaLow)).toBe(true);
    expect(Number.isFinite(profile.valueAreaHigh)).toBe(true);
  });

  it('clamps an off-range candle into the nearest edge bin (no lost volume)', () => {
    // Candle entirely above the range → its volume lands in the top bin.
    const view = viewFromRows([{ l: 20, h: 25, v: 70 }]);
    const profile = computeVolumeProfile(view, 5, 0, 10);
    expect(profile.totalVolume).toBeCloseTo(70, 6);
    expect(profile.bins[4]!.volume).toBeCloseTo(70, 6);
  });

  it('returns a single empty bin with pocIndex -1 for an empty view', () => {
    const profile = computeVolumeProfile(viewFromRows([]), 10, 0, 10);
    expect(profile.totalVolume).toBe(0);
    expect(profile.pocIndex).toBe(-1);
    expect(profile.bins.length).toBe(10);
  });

  it('repairs a degenerate (flat / inverted) price range without dividing by zero', () => {
    const flat = computeVolumeProfile(viewFromRows([{ l: 5, h: 5, v: 10 }]), 4, 5, 5);
    expect(flat.bins.length).toBe(4);
    expect(flat.bins[flat.bins.length - 1]!.priceHigh).toBeGreaterThan(flat.bins[0]!.priceLow);
    // Inverted range is swapped and still bins.
    const inv = computeVolumeProfile(viewFromRows([{ l: 2, h: 8, v: 10 }]), 6, 10, 0);
    expect(inv.totalVolume).toBeCloseTo(10, 6);
  });
});

// ---------------------------------------------------------------------------
// VolumeProfilePrimitive.draw
// ---------------------------------------------------------------------------
describe('VolumeProfilePrimitive.draw', () => {
  const LAYOUT: ChartLayout = computeLayout(1000, 500);

  function vp(): Viewport {
    const v = new Viewport();
    v.setLayout(LAYOUT);
    v.startIndex = 0;
    v.visibleCount = 100;
    v.priceMin = 90;
    v.priceMax = 110;
    return v;
  }

  it('is a bottom-tier primitive with a stable id', () => {
    const p = new VolumeProfilePrimitive(() => null);
    expect(p.zOrder).toBe('bottom');
    expect(p.id).toBe('volume-profile');
  });

  it('clips and fills bars when there is a visible window', () => {
    const view = viewFromRows([
      { l: 95, h: 100, v: 100 },
      { l: 100, h: 105, v: 200 },
      { l: 98, h: 102, v: 150 },
    ]);
    const ctx = makeCtx();
    new VolumeProfilePrimitive(() => view, { bins: 10 }).draw(ctx, LAYOUT, vp(), DARK_THEME);
    const names = ctx.__ops.map((o) => `${o.type}:${o.name}`);
    expect(names).toContain('call:save');
    expect(names).toContain('call:clip');
    expect(names).toContain('call:restore');
    expect(ctx.__ops.filter((o) => o.name === 'fillRect').length).toBeGreaterThan(0);
  });

  it('anchors bars to the right edge by default and the left edge when asked', () => {
    const view = viewFromRows([{ l: 95, h: 100, v: 100 }]);
    const right = makeCtx();
    new VolumeProfilePrimitive(() => view, { bins: 4, side: 'right', widthRatio: 0.3 }).draw(
      right,
      LAYOUT,
      vp(),
      DARK_THEME,
    );
    const rRect = right.__ops.find((o) => o.name === 'fillRect');
    const rX = rRect!.args![0] as number;
    const rW = rRect!.args![2] as number;
    // Right-anchored: x + w == chartRight.
    expect(rX + rW).toBeCloseTo(LAYOUT.chartRight, 4);

    const left = makeCtx();
    new VolumeProfilePrimitive(() => view, { bins: 4, side: 'left', widthRatio: 0.3 }).draw(
      left,
      LAYOUT,
      vp(),
      DARK_THEME,
    );
    const lRect = left.__ops.find((o) => o.name === 'fillRect');
    expect(lRect!.args![0] as number).toBeCloseTo(LAYOUT.chartLeft, 4);
  });

  it('the longest bar spans widthRatio of the chart width', () => {
    // Single bin holding all the volume → its bar is the max length.
    const view = viewFromRows([{ l: 100, h: 100, v: 500 }]);
    const ctx = makeCtx();
    const ratio = 0.25;
    new VolumeProfilePrimitive(() => view, { bins: 8, widthRatio: ratio }).draw(ctx, LAYOUT, vp(), DARK_THEME);
    const widths = ctx.__ops.filter((o) => o.name === 'fillRect').map((o) => o.args![2] as number);
    const maxW = Math.max(...widths);
    expect(maxW).toBeCloseTo((LAYOUT.chartRight - LAYOUT.chartLeft) * ratio, 3);
  });

  it('draws nothing (no save) when the view is null or has zero volume', () => {
    const nullCtx = makeCtx();
    new VolumeProfilePrimitive(() => null).draw(nullCtx, LAYOUT, vp(), DARK_THEME);
    expect(nullCtx.__ops.some((o) => o.name === 'save')).toBe(false);

    const zeroCtx = makeCtx();
    const view = viewFromRows([{ l: 95, h: 100, v: 0 }]);
    new VolumeProfilePrimitive(() => view).draw(zeroCtx, LAYOUT, vp(), DARK_THEME);
    expect(zeroCtx.__ops.some((o) => o.name === 'save')).toBe(false);
  });

  it('computeFor exposes the profile numbers (POC, value area) for hosts', () => {
    const view = viewFromRows([
      { l: 95, h: 96, v: 10 },
      { l: 100, h: 101, v: 300 },
      { l: 104, h: 105, v: 10 },
    ]);
    const p = new VolumeProfilePrimitive(() => view, { bins: 20 });
    const profile = p.computeFor(vp());
    expect(profile).not.toBeNull();
    const poc = profile!.bins[profile!.pocIndex]!;
    expect(poc.priceLow).toBeLessThanOrEqual(100.5);
    expect(poc.priceHigh).toBeGreaterThanOrEqual(100.5);
  });

  it('does not throw against a real ChartEngine after attach + forceRender', () => {
    installCanvasStub();
    const container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({ width: 1000, height: 500, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, toJSON() {} }) as DOMRect;
    document.body.appendChild(container);
    const engine = new ChartEngine(container, DARK_THEME);
    const buf = makeBuffer(40);
    engine.setBuffer(buf);
    engine.viewport.startIndex = 0;
    engine.viewport.visibleCount = 40;

    engine.attachPrimitive(new VolumeProfilePrimitive(() => engine.visibleCandleView(), { bins: 24 }));
    expect(() => forceRender(engine)).not.toThrow();
    engine.destroy();
    container.remove();
  });
});

// ---------------------------------------------------------------------------
// ChartEngine.visibleCandleView — the data seam
// ---------------------------------------------------------------------------
describe('ChartEngine.visibleCandleView', () => {
  beforeAll(() => installCanvasStub());

  function makeEngine(): { engine: ChartEngine; container: HTMLDivElement } {
    const container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({ width: 1000, height: 500, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, toJSON() {} }) as DOMRect;
    document.body.appendChild(container);
    const engine = new ChartEngine(container, DARK_THEME);
    return { engine, container };
  }

  it('returns null with no buffer or an empty window, the visible slice otherwise', () => {
    const { engine, container } = makeEngine();
    expect(engine.visibleCandleView()).toBeNull(); // no buffer

    engine.setBuffer(makeBuffer(50));
    engine.viewport.startIndex = 10;
    engine.viewport.visibleCount = 20;
    const view = engine.visibleCandleView();
    expect(view).not.toBeNull();
    expect(view!.offset).toBe(10);
    expect(view!.length).toBe(20);

    // Scroll fully past the data → empty window → null.
    engine.viewport.startIndex = 1000;
    expect(engine.visibleCandleView()).toBeNull();

    engine.destroy();
    container.remove();
  });
});

// ---------------------------------------------------------------------------
// VolumeProfileController — attach/detach lifecycle through the host
// ---------------------------------------------------------------------------
describe('VolumeProfileController', () => {
  let container: HTMLDivElement;
  let engine: ChartEngine;

  beforeAll(() => installCanvasStub());

  beforeEach(() => {
    container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({ width: 1000, height: 500, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, toJSON() {} }) as DOMRect;
    document.body.appendChild(container);
    engine = new ChartEngine(container, DARK_THEME);
    engine.setBuffer(makeBuffer(40));
    engine.viewport.startIndex = 0;
    engine.viewport.visibleCount = 40;
  });

  afterEach(() => {
    engine.destroy();
    container.remove();
  });

  function hasPrimitive(id: string): boolean {
    return engine.primitives.some((p: Primitive) => p.id === id);
  }

  it('show attaches the volume-profile primitive; hide detaches it', () => {
    const vp = new VolumeProfileController(engine);
    expect(vp.visible).toBe(false);
    vp.show({ bins: 30 });
    expect(vp.visible).toBe(true);
    expect(engine.primitives.length).toBe(1);
    expect(hasPrimitive('volume-profile')).toBe(true);

    expect(vp.hide()).toBe(true);
    expect(vp.visible).toBe(false);
    expect(hasPrimitive('volume-profile')).toBe(false);
    expect(vp.hide()).toBe(false); // already hidden
  });

  it('show is idempotent — a repeat call re-applies options without a duplicate', () => {
    const vp = new VolumeProfileController(engine);
    vp.show({ side: 'right' });
    vp.show({ side: 'left', bins: 50 });
    expect(engine.primitives.filter((p) => p.id === 'volume-profile').length).toBe(1);
    expect(vp.primitive!.options.side).toBe('left');
    expect(vp.primitive!.options.bins).toBe(50);
  });

  it('setOptions / update no-op when hidden and mutate in place when shown', () => {
    const vp = new VolumeProfileController(engine);
    vp.setOptions({ bins: 10 }); // hidden → no-op, no throw
    vp.update(); // hidden → no-op
    expect(vp.visible).toBe(false);

    vp.show();
    vp.setOptions({ widthRatio: 0.5 });
    expect(vp.primitive!.options.widthRatio).toBeCloseTo(0.5, 6);
    expect(() => vp.update()).not.toThrow();
  });

  it('works through a minimal structural host (not just ChartEngine)', () => {
    const attached: Primitive[] = [];
    const host: VolumeProfileHost = {
      attachPrimitive: (p) => {
        attached.push(p);
      },
      detachPrimitive: (id) => {
        const i = attached.findIndex((p) => p.id === id);
        if (i === -1) return false;
        attached.splice(i, 1);
        return true;
      },
      visibleCandleView: () => null,
    };
    const vp = new VolumeProfileController(host);
    vp.show();
    expect(attached.map((p) => p.id)).toEqual(['volume-profile']);
    vp.hide();
    expect(attached).toHaveLength(0);
  });
});
