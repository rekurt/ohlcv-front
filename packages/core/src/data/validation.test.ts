import { describe, it, expect } from 'vitest';
import { validateCandle, validateCandles, ValidationError } from './validation';

const validCandle = { o: 100, h: 110, l: 95, c: 105, v: 1_500, t: 1_700_000_000 };

describe('ValidationError', () => {
  it('is an Error subclass with structured fields', () => {
    const err = new ValidationError('test', { foo: 1 }, 'something went wrong');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ValidationError');
    expect(err.where).toBe('test');
    expect(err.received).toEqual({ foo: 1 });
    expect(err.message).toContain('[ohlcv]');
    expect(err.message).toContain('test');
    expect(err.message).toContain('something went wrong');
  });
});

describe('validateCandle', () => {
  it('accepts a well-formed candle', () => {
    expect(validateCandle(validCandle, 'unit')).toEqual(validCandle);
  });

  it('rejects null and undefined', () => {
    expect(() => validateCandle(null, 'x')).toThrow(ValidationError);
    expect(() => validateCandle(undefined, 'x')).toThrow(ValidationError);
  });

  it('rejects primitives', () => {
    expect(() => validateCandle(42, 'x')).toThrow(ValidationError);
    expect(() => validateCandle('candle', 'x')).toThrow(ValidationError);
    expect(() => validateCandle(true, 'x')).toThrow(ValidationError);
  });

  it('rejects arrays', () => {
    expect(() => validateCandle([], 'x')).toThrow(ValidationError);
    expect(() => validateCandle([1, 2, 3], 'x')).toThrow(ValidationError);
  });

  it('rejects missing number fields', () => {
    const missing = { ...validCandle, t: undefined };
    expect(() => validateCandle(missing, 'x')).toThrow(/t/);
  });

  it('rejects string fields', () => {
    const stringT = { ...validCandle, t: '1700000000' };
    expect(() => validateCandle(stringT, 'x')).toThrow(/t/);
  });

  it('rejects NaN fields', () => {
    expect(() => validateCandle({ ...validCandle, c: NaN }, 'x')).toThrow(/c/);
  });

  it('rejects Infinity fields', () => {
    expect(() => validateCandle({ ...validCandle, h: Infinity }, 'x')).toThrow(/h/);
  });

  it('rejects non-positive time', () => {
    expect(() => validateCandle({ ...validCandle, t: 0 }, 'x')).toThrow(/t/);
    expect(() => validateCandle({ ...validCandle, t: -1 }, 'x')).toThrow(/t/);
  });

  it('rejects high < low', () => {
    expect(() => validateCandle({ ...validCandle, h: 90, l: 100 }, 'x')).toThrow(/high.*low|h.*l/);
  });

  it('rejects high below open or close', () => {
    expect(() => validateCandle({ ...validCandle, o: 120, h: 110 }, 'x')).toThrow(/high/);
    expect(() => validateCandle({ ...validCandle, c: 120, h: 110 }, 'x')).toThrow(/high/);
  });

  it('rejects low above open or close', () => {
    expect(() => validateCandle({ ...validCandle, o: 90, l: 95 }, 'x')).toThrow(/low/);
    expect(() => validateCandle({ ...validCandle, c: 90, l: 95 }, 'x')).toThrow(/low/);
  });

  it('rejects negative volume', () => {
    expect(() => validateCandle({ ...validCandle, v: -1 }, 'x')).toThrow(/volume|v/);
  });

  it('accepts zero volume', () => {
    expect(validateCandle({ ...validCandle, v: 0 }, 'x').v).toBe(0);
  });

  it('accepts o === h === l === c (doji)', () => {
    const doji = { ...validCandle, o: 100, h: 100, l: 100, c: 100 };
    expect(() => validateCandle(doji, 'x')).not.toThrow();
  });

  it('strips extra fields (returns only Candle shape)', () => {
    const withExtras = { ...validCandle, foo: 'bar', nested: { a: 1 } };
    const result = validateCandle(withExtras, 'x');
    expect(Object.keys(result).sort()).toEqual(['c', 'h', 'l', 'o', 't', 'v']);
  });
});

describe('validateCandles', () => {
  it('accepts an empty array', () => {
    expect(validateCandles([], 'unit')).toEqual([]);
  });

  it('accepts an array of valid candles', () => {
    const arr = [validCandle, { ...validCandle, t: validCandle.t + 60 }];
    expect(validateCandles(arr, 'unit')).toHaveLength(2);
  });

  it('rejects non-array', () => {
    expect(() => validateCandles(null, 'x')).toThrow(ValidationError);
    expect(() => validateCandles({}, 'x')).toThrow(ValidationError);
    expect(() => validateCandles('candles', 'x')).toThrow(ValidationError);
  });

  it('includes index in error when a single element is invalid', () => {
    const arr = [validCandle, { ...validCandle, t: 'bad' }];
    expect(() => validateCandles(arr, 'fetchHistory')).toThrow(/\[1\]|index.*1/);
  });
});
