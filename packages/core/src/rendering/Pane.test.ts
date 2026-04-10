import { describe, it, expect } from 'vitest';
import { Pane, PaneLayout, type PaneKind } from './Pane';

describe('Pane', () => {
  it('constructs with id, kind, and default linear scale', () => {
    const pane = new Pane('main', 'price', 0.8);
    expect(pane.id).toBe('main');
    expect(pane.kind).toBe<PaneKind>('price');
    expect(pane.heightRatio).toBe(0.8);
    expect(pane.yScale).toBe('linear');
  });

  it('clamps heightRatio to [0.01, 1]', () => {
    const tiny = new Pane('a', 'indicator', 0.001);
    expect(tiny.heightRatio).toBe(0.01);
    const big = new Pane('b', 'indicator', 2);
    expect(big.heightRatio).toBe(1);
  });

  it('allows switching yScale to log', () => {
    const pane = new Pane('main', 'price', 1);
    pane.yScale = 'log';
    expect(pane.yScale).toBe('log');
  });

  it('tracks priceMin/priceMax/volumeMax independently', () => {
    const pane = new Pane('main', 'price', 1);
    pane.priceMin = 100;
    pane.priceMax = 200;
    pane.volumeMax = 5000;
    expect(pane.priceMin).toBe(100);
    expect(pane.priceMax).toBe(200);
    expect(pane.volumeMax).toBe(5000);
  });

  describe('priceToY (linear)', () => {
    const pane = new Pane('main', 'price', 1);
    pane.priceMin = 100;
    pane.priceMax = 200;
    pane.top = 10;
    pane.bottom = 210;

    it('maps priceMin to bottom', () => {
      expect(pane.priceToY(100)).toBeCloseTo(210);
    });

    it('maps priceMax to top', () => {
      expect(pane.priceToY(200)).toBeCloseTo(10);
    });

    it('maps midpoint to middle', () => {
      expect(pane.priceToY(150)).toBeCloseTo(110);
    });

    it('returns center when range is zero', () => {
      const flat = new Pane('f', 'price', 1);
      flat.priceMin = 100;
      flat.priceMax = 100;
      flat.top = 0;
      flat.bottom = 100;
      expect(flat.priceToY(100)).toBeCloseTo(50);
    });
  });

  describe('priceToY (log)', () => {
    const pane = new Pane('main', 'price', 1);
    pane.yScale = 'log';
    pane.priceMin = 100;
    pane.priceMax = 10_000;
    pane.top = 0;
    pane.bottom = 400;

    it('maps priceMin to bottom', () => {
      expect(pane.priceToY(100)).toBeCloseTo(400);
    });

    it('maps priceMax to top', () => {
      expect(pane.priceToY(10_000)).toBeCloseTo(0);
    });

    it('maps geometric midpoint to middle (1000)', () => {
      expect(pane.priceToY(1000)).toBeCloseTo(200);
    });
  });

  describe('yToPrice is inverse of priceToY', () => {
    it('linear roundtrip', () => {
      const pane = new Pane('a', 'price', 1);
      pane.priceMin = 42_000;
      pane.priceMax = 43_000;
      pane.top = 0;
      pane.bottom = 500;
      for (const y of [0, 100, 250, 400, 500]) {
        const price = pane.yToPrice(y);
        expect(pane.priceToY(price)).toBeCloseTo(y);
      }
    });

    it('log roundtrip', () => {
      const pane = new Pane('a', 'price', 1);
      pane.yScale = 'log';
      pane.priceMin = 10;
      pane.priceMax = 100_000;
      pane.top = 0;
      pane.bottom = 500;
      for (const y of [0, 100, 250, 400, 500]) {
        const price = pane.yToPrice(y);
        expect(pane.priceToY(price)).toBeCloseTo(y);
      }
    });
  });

  describe('volumeToY', () => {
    it('maps volume=0 to bottom', () => {
      const pane = new Pane('v', 'volume', 0.2);
      pane.top = 100;
      pane.bottom = 200;
      pane.volumeMax = 1000;
      expect(pane.volumeToY(0)).toBeCloseTo(200);
    });

    it('maps volume=max to top', () => {
      const pane = new Pane('v', 'volume', 0.2);
      pane.top = 100;
      pane.bottom = 200;
      pane.volumeMax = 1000;
      expect(pane.volumeToY(1000)).toBeCloseTo(100);
    });

    it('returns bottom when volumeMax is zero', () => {
      const pane = new Pane('v', 'volume', 0.2);
      pane.top = 100;
      pane.bottom = 200;
      expect(pane.volumeToY(500)).toBe(200);
    });
  });
});

describe('PaneLayout', () => {
  it('defaults to a single price pane occupying full height', () => {
    const layout = new PaneLayout();
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0]!.kind).toBe('price');
    expect(layout.panes[0]!.heightRatio).toBe(1);
  });

  it('addPane appends a new pane and renormalizes heights', () => {
    const layout = new PaneLayout();
    layout.addPane(new Pane('rsi', 'indicator', 0.25));
    expect(layout.panes).toHaveLength(2);
    // Heights should sum to 1 after normalization
    const total = layout.panes.reduce((sum, p) => sum + p.heightRatio, 0);
    expect(total).toBeCloseTo(1);
  });

  it('removePane by id drops the pane and renormalizes', () => {
    const layout = new PaneLayout();
    layout.addPane(new Pane('rsi', 'indicator', 0.25));
    layout.addPane(new Pane('macd', 'indicator', 0.25));
    expect(layout.panes).toHaveLength(3);

    layout.removePane('rsi');
    expect(layout.panes).toHaveLength(2);
    expect(layout.panes.find((p) => p.id === 'rsi')).toBeUndefined();
    const total = layout.panes.reduce((sum, p) => sum + p.heightRatio, 0);
    expect(total).toBeCloseTo(1);
  });

  it('getPane returns pane by id', () => {
    const layout = new PaneLayout();
    layout.addPane(new Pane('rsi', 'indicator', 0.2));
    expect(layout.getPane('rsi')?.kind).toBe('indicator');
    expect(layout.getPane('main')?.kind).toBe('price');
    expect(layout.getPane('nonexistent')).toBeUndefined();
  });

  it('computeBounds assigns top/bottom to every pane', () => {
    const layout = new PaneLayout();
    layout.addPane(new Pane('rsi', 'indicator', 0.25));
    layout.computeBounds(0, 400);

    // Two panes: main=0.75, rsi=0.25 → main occupies 0..300, rsi occupies 300..400
    const main = layout.getPane('main')!;
    const rsi = layout.getPane('rsi')!;
    expect(main.top).toBe(0);
    expect(main.bottom).toBeCloseTo(300);
    expect(rsi.top).toBeCloseTo(300);
    expect(rsi.bottom).toBe(400);
  });

  it('computeBounds handles stacking of 3 panes', () => {
    const layout = new PaneLayout();
    layout.addPane(new Pane('rsi', 'indicator', 0.15));
    layout.addPane(new Pane('macd', 'indicator', 0.15));
    layout.computeBounds(0, 500);

    // Normalized: main=0.7/1.0*500=350, rsi=0.15*500=75, macd=0.15*500=75 → boundaries 0,350,425,500
    const main = layout.getPane('main')!;
    const rsi = layout.getPane('rsi')!;
    const macd = layout.getPane('macd')!;
    expect(main.top).toBe(0);
    expect(main.bottom).toBeCloseTo(350);
    expect(rsi.top).toBeCloseTo(350);
    expect(rsi.bottom).toBeCloseTo(425);
    expect(macd.top).toBeCloseTo(425);
    expect(macd.bottom).toBe(500);
  });

  it('computeBounds without sub-panes gives main full range', () => {
    const layout = new PaneLayout();
    layout.computeBounds(20, 500);
    const main = layout.getPane('main')!;
    expect(main.top).toBe(20);
    expect(main.bottom).toBe(500);
  });
});
