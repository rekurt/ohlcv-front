import { describe, it, expect } from 'vitest';
import { ExponentialBackoff } from './ExponentialBackoff';

describe('ExponentialBackoff', () => {
  it('throws if baseDelay is not positive', () => {
    expect(() => new ExponentialBackoff({ baseDelay: 0 })).toThrow();
    expect(() => new ExponentialBackoff({ baseDelay: -100 })).toThrow();
  });

  it('throws if maxDelay is less than baseDelay', () => {
    expect(() => new ExponentialBackoff({ baseDelay: 1000, maxDelay: 500 })).toThrow();
  });

  it('starts with 0 attempts', () => {
    const b = new ExponentialBackoff();
    expect(b.attempts).toBe(0);
  });

  it('increments attempt counter on each nextDelay', () => {
    const b = new ExponentialBackoff({ rng: () => 1 });
    b.nextDelay();
    expect(b.attempts).toBe(1);
    b.nextDelay();
    expect(b.attempts).toBe(2);
  });

  it('first delay is up to baseDelay (attempt 0 → 2^0 = 1)', () => {
    const b = new ExponentialBackoff({ baseDelay: 500, maxDelay: 30_000, rng: () => 1 });
    // rng=1 → full exponent, no jitter shrinkage
    expect(b.nextDelay()).toBe(500); // 500 * 2^0 = 500
  });

  it('doubles the upper bound each attempt', () => {
    const b = new ExponentialBackoff({ baseDelay: 100, maxDelay: 10_000, rng: () => 1 });
    expect(b.nextDelay()).toBe(100);  // 100 * 1
    expect(b.nextDelay()).toBe(200);  // 100 * 2
    expect(b.nextDelay()).toBe(400);  // 100 * 4
    expect(b.nextDelay()).toBe(800);  // 100 * 8
  });

  it('clamps upper bound at maxDelay', () => {
    const b = new ExponentialBackoff({ baseDelay: 100, maxDelay: 300, rng: () => 1 });
    expect(b.nextDelay()).toBe(100);
    expect(b.nextDelay()).toBe(200);
    expect(b.nextDelay()).toBe(300); // clamped (would be 400)
    expect(b.nextDelay()).toBe(300); // still clamped
    expect(b.nextDelay()).toBe(300);
  });

  it('applies full jitter: actual delay = rng * upper', () => {
    const b = new ExponentialBackoff({ baseDelay: 1000, maxDelay: 10_000, rng: () => 0.5 });
    expect(b.nextDelay()).toBe(500); // 0.5 * 1000
    expect(b.nextDelay()).toBe(1000); // 0.5 * 2000
  });

  it('rng=0 produces zero delay (minimum jitter)', () => {
    const b = new ExponentialBackoff({ baseDelay: 1000, rng: () => 0 });
    expect(b.nextDelay()).toBe(0);
    expect(b.nextDelay()).toBe(0);
  });

  it('reset drops counter back to zero', () => {
    const b = new ExponentialBackoff({ baseDelay: 100, rng: () => 1 });
    b.nextDelay();
    b.nextDelay();
    b.nextDelay();
    expect(b.attempts).toBe(3);
    b.reset();
    expect(b.attempts).toBe(0);
    // Next call should start from 2^0 again
    expect(b.nextDelay()).toBe(100);
  });
});
