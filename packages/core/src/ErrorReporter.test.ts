import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorReporter } from './ErrorReporter';
import type { ChartError } from './types';

describe('ErrorReporter', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('dispatches to the provided callback', () => {
    const received: ChartError[] = [];
    const reporter = new ErrorReporter((err) => received.push(err));
    reporter.report('fetchHistory', new Error('network down'));
    expect(received).toHaveLength(1);
    expect(received[0]!.where).toBe('fetchHistory');
    expect(received[0]!.error.message).toBe('network down');
    expect(received[0]!.fatal).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('defaults fatal to false', () => {
    const received: ChartError[] = [];
    const reporter = new ErrorReporter((err) => received.push(err));
    reporter.report('subscribe', new Error('x'));
    expect(received[0]!.fatal).toBe(false);
  });

  it('propagates explicit fatal flag', () => {
    const received: ChartError[] = [];
    const reporter = new ErrorReporter((err) => received.push(err));
    reporter.report('fetchHistory', new Error('x'), true);
    expect(received[0]!.fatal).toBe(true);
  });

  it('wraps non-Error throwables in Error instances', () => {
    const received: ChartError[] = [];
    const reporter = new ErrorReporter((err) => received.push(err));
    reporter.report('parseCandles', 'string error');
    expect(received[0]!.error).toBeInstanceOf(Error);
    expect(received[0]!.error.message).toBe('string error');
  });

  it('wraps thrown objects like { message: "x" }', () => {
    const received: ChartError[] = [];
    const reporter = new ErrorReporter((err) => received.push(err));
    reporter.report('parseCandles', { code: 42 });
    expect(received[0]!.error).toBeInstanceOf(Error);
  });

  it('falls back to console.warn when no handler is configured', () => {
    const reporter = new ErrorReporter();
    reporter.report('fetchHistory', new Error('no handler'));
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(String(warnSpy.mock.calls[0]![0])).toContain('fetchHistory');
  });

  it('marks fatal in the console.warn fallback message', () => {
    const reporter = new ErrorReporter();
    reporter.report('fetchHistory', new Error('boom'), true);
    expect(String(warnSpy.mock.calls[0]![0])).toContain('fatal');
  });

  it('swallows exceptions thrown by the handler', () => {
    const reporter = new ErrorReporter(() => {
      throw new Error('handler crashed');
    });
    // Must not throw — a broken handler should never cascade.
    expect(() => reporter.report('render', new Error('inner'))).not.toThrow();
  });
});
