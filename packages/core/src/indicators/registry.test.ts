import { describe, it, expect } from 'vitest';
import {
  createIndicator,
  indicatorId,
  diffIndicatorConfigs,
  type IndicatorConfig,
} from './registry';
import { SMA } from './SMA';
import { EMA } from './EMA';
import { BollingerBands } from './BollingerBands';
import { RSI } from './RSI';
import { MACD } from './MACD';
import { Stochastic } from './Stochastic';
import { ATR } from './ATR';
import { VWAP } from './VWAP';
import { WilliamsR } from './WilliamsR';
import { OBV } from './OBV';
import { ADX } from './ADX';
import { CCI } from './CCI';

describe('indicatorId', () => {
  it('produces stable id for equivalent configs', () => {
    expect(indicatorId({ type: 'sma', period: 20 })).toBe(
      indicatorId({ type: 'sma', period: 20 }),
    );
  });

  it('differs across period', () => {
    expect(indicatorId({ type: 'sma', period: 20 })).not.toBe(
      indicatorId({ type: 'sma', period: 50 }),
    );
  });

  it('differs across types', () => {
    expect(indicatorId({ type: 'sma', period: 20 })).not.toBe(
      indicatorId({ type: 'ema', period: 20 }),
    );
  });

  it('encodes BB stdDev', () => {
    expect(indicatorId({ type: 'bb', period: 20, stdDev: 2 })).toBe('bb:20:2');
    expect(indicatorId({ type: 'bb', period: 20, stdDev: 3 })).not.toBe(
      indicatorId({ type: 'bb', period: 20, stdDev: 2 }),
    );
  });

  it('encodes MACD triplet', () => {
    expect(indicatorId({ type: 'macd', fast: 12, slow: 26, signal: 9 })).toBe(
      'macd:12:26:9',
    );
  });

  it('encodes VWAP anchor', () => {
    expect(indicatorId({ type: 'vwap', anchor: 'session' })).toBe('vwap:session');
  });

  it('encodes the M2 extra indicators', () => {
    expect(indicatorId({ type: 'williamsr', period: 14 })).toBe('williamsr:14');
    expect(indicatorId({ type: 'obv' })).toBe('obv');
    expect(indicatorId({ type: 'adx', period: 14 })).toBe('adx:14');
    expect(indicatorId({ type: 'cci', period: 20 })).toBe('cci:20');
  });
});

describe('createIndicator', () => {
  it('creates SMA instance', () => {
    expect(createIndicator({ type: 'sma', period: 20 })).toBeInstanceOf(SMA);
  });

  it('creates EMA instance', () => {
    expect(createIndicator({ type: 'ema', period: 50 })).toBeInstanceOf(EMA);
  });

  it('creates BollingerBands instance', () => {
    expect(
      createIndicator({ type: 'bb', period: 20, stdDev: 2 }),
    ).toBeInstanceOf(BollingerBands);
  });

  it('creates RSI instance', () => {
    expect(createIndicator({ type: 'rsi', period: 14 })).toBeInstanceOf(RSI);
  });

  it('creates MACD instance', () => {
    expect(
      createIndicator({ type: 'macd', fast: 12, slow: 26, signal: 9 }),
    ).toBeInstanceOf(MACD);
  });

  it('creates Stochastic instance', () => {
    expect(
      createIndicator({ type: 'stoch', kPeriod: 14, dPeriod: 3 }),
    ).toBeInstanceOf(Stochastic);
  });

  it('creates ATR instance', () => {
    expect(createIndicator({ type: 'atr', period: 14 })).toBeInstanceOf(ATR);
  });

  it('creates VWAP instance', () => {
    expect(createIndicator({ type: 'vwap', anchor: 'session' })).toBeInstanceOf(
      VWAP,
    );
  });

  it('creates WilliamsR instance', () => {
    expect(createIndicator({ type: 'williamsr', period: 14 })).toBeInstanceOf(WilliamsR);
  });

  it('creates OBV instance', () => {
    expect(createIndicator({ type: 'obv' })).toBeInstanceOf(OBV);
  });

  it('creates ADX instance', () => {
    expect(createIndicator({ type: 'adx', period: 14 })).toBeInstanceOf(ADX);
  });

  it('creates CCI instance', () => {
    expect(createIndicator({ type: 'cci', period: 20 })).toBeInstanceOf(CCI);
  });

  it('throws on unknown type (forged runtime JSON)', () => {
    // Cast around the compile-time exhaustiveness check to simulate
    // loadState called with an unknown future indicator type.
    const forged = { type: 'xyz', period: 1 } as unknown as IndicatorConfig;
    expect(() => createIndicator(forged)).toThrow(/Unknown indicator type/);
  });
});

describe('diffIndicatorConfigs', () => {
  it('reports no change for empty→empty', () => {
    const d = diffIndicatorConfigs([], []);
    expect(d.changed).toBe(false);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.kept).toEqual([]);
  });

  it('detects added', () => {
    const d = diffIndicatorConfigs([], [{ type: 'sma', period: 20 }]);
    expect(d.changed).toBe(true);
    expect(d.added).toEqual(['sma:20']);
  });

  it('detects removed', () => {
    const d = diffIndicatorConfigs([{ type: 'sma', period: 20 }], []);
    expect(d.changed).toBe(true);
    expect(d.removed).toEqual(['sma:20']);
  });

  it('detects no change when arrays have identical shapes', () => {
    const d = diffIndicatorConfigs(
      [{ type: 'sma', period: 20 }],
      [{ type: 'sma', period: 20 }],
    );
    expect(d.changed).toBe(false);
    expect(d.kept).toEqual(['sma:20']);
  });

  it('detects simultaneous add + remove', () => {
    const d = diffIndicatorConfigs(
      [{ type: 'sma', period: 20 }],
      [{ type: 'ema', period: 50 }],
    );
    expect(d.changed).toBe(true);
    expect(d.added).toEqual(['ema:50']);
    expect(d.removed).toEqual(['sma:20']);
  });

  it('handles duplicates by deduping', () => {
    const d = diffIndicatorConfigs(
      [
        { type: 'sma', period: 20 },
        { type: 'sma', period: 20 },
      ],
      [{ type: 'sma', period: 20 }],
    );
    expect(d.changed).toBe(false);
  });

  it('detects config parameter change as add+remove', () => {
    const d = diffIndicatorConfigs(
      [{ type: 'sma', period: 20 }],
      [{ type: 'sma', period: 50 }],
    );
    expect(d.changed).toBe(true);
    expect(d.removed).toEqual(['sma:20']);
    expect(d.added).toEqual(['sma:50']);
  });
});
