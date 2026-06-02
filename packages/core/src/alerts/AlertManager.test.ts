import { describe, it, expect } from 'vitest';
import { AlertManager } from './AlertManager';

describe('AlertManager', () => {
  describe('add / id generation', () => {
    it('generates stable a_<n> ids in order and defaults condition + active', () => {
      const mgr = new AlertManager();
      const a = mgr.add({ price: 100 });
      const b = mgr.add({ price: 200 });
      expect(a.id).toBe('a_0');
      expect(b.id).toBe('a_1');
      expect(a.condition).toBe('crossing'); // default
      expect(a.active).toBe(true);
      expect(a.price).toBe(100);
    });

    it('honors an explicit id and condition/message', () => {
      const mgr = new AlertManager();
      const a = mgr.add({ id: 'custom', price: 50, condition: 'above', message: 'hi' });
      expect(a.id).toBe('custom');
      expect(a.condition).toBe('above');
      expect(a.message).toBe('hi');
    });

    it('omits message entirely when not provided', () => {
      const mgr = new AlertManager();
      const a = mgr.add({ price: 100 });
      expect('message' in a).toBe(false);
    });

    it('advances the counter past a restored a_<n> id to avoid collisions', () => {
      const mgr = new AlertManager();
      mgr.add({ id: 'a_5', price: 100 }); // restored
      const next = mgr.add({ price: 200 }); // auto-generated
      expect(next.id).toBe('a_6');
    });
  });

  describe('get / list / remove / clear', () => {
    it('lists in insertion order and looks up by id', () => {
      const mgr = new AlertManager();
      mgr.add({ id: 'x', price: 1 });
      mgr.add({ id: 'y', price: 2 });
      expect(mgr.list().map((a) => a.id)).toEqual(['x', 'y']);
      expect(mgr.get('y')?.price).toBe(2);
      expect(mgr.get('missing')).toBeUndefined();
    });

    it('list returns a copy (mutating it does not affect the collection)', () => {
      const mgr = new AlertManager();
      mgr.add({ id: 'x', price: 1 });
      const snap = mgr.list();
      snap.length = 0;
      expect(mgr.list()).toHaveLength(1);
    });

    it('removes by id and reports success', () => {
      const mgr = new AlertManager();
      mgr.add({ id: 'x', price: 1 });
      expect(mgr.remove('x')).toBe(true);
      expect(mgr.remove('x')).toBe(false);
      expect(mgr.list()).toHaveLength(0);
    });

    it('clear empties the collection', () => {
      const mgr = new AlertManager();
      mgr.add({ price: 1 });
      mgr.add({ price: 2 });
      mgr.clear();
      expect(mgr.list()).toHaveLength(0);
    });
  });

  describe('check — condition semantics', () => {
    it('crossing fires when price moves up through the level', () => {
      const mgr = new AlertManager();
      const a = mgr.add({ price: 100, condition: 'crossing' });
      const fired = mgr.check(99, 101);
      expect(fired.map((x) => x.id)).toEqual([a.id]);
    });

    it('crossing fires when price moves down through the level', () => {
      const mgr = new AlertManager();
      const a = mgr.add({ price: 100, condition: 'crossing' });
      expect(mgr.check(101, 99).map((x) => x.id)).toEqual([a.id]);
    });

    it('crossing fires when the new price lands exactly on the level', () => {
      const mgr = new AlertManager();
      mgr.add({ price: 100, condition: 'crossing' });
      expect(mgr.check(98, 100)).toHaveLength(1);
    });

    it('crossing does NOT fire when both prices stay on the same side', () => {
      const mgr = new AlertManager();
      mgr.add({ price: 100, condition: 'crossing' });
      expect(mgr.check(101, 105)).toHaveLength(0);
      expect(mgr.check(95, 99)).toHaveLength(0);
    });

    it('crossing does NOT fire when price moves OFF the level (no new cross)', () => {
      const mgr = new AlertManager();
      mgr.add({ price: 100, condition: 'crossing' });
      // started exactly on the level, moved up — not a fresh crossing
      expect(mgr.check(100, 105)).toHaveLength(0);
    });

    it('above fires only on an upward break', () => {
      const mgr = new AlertManager();
      mgr.add({ price: 100, condition: 'above' });
      expect(mgr.check(99, 100)).toHaveLength(1); // >= triggers
    });

    it('above does NOT fire on a downward cross or when already above', () => {
      const mgr = new AlertManager();
      mgr.add({ price: 100, condition: 'above' });
      expect(mgr.check(101, 99)).toHaveLength(0); // downward
      expect(mgr.check(101, 105)).toHaveLength(0); // already above
    });

    it('below fires only on a downward break', () => {
      const mgr = new AlertManager();
      mgr.add({ price: 100, condition: 'below' });
      expect(mgr.check(101, 100)).toHaveLength(1); // <= triggers
    });

    it('below does NOT fire on an upward cross or when already below', () => {
      const mgr = new AlertManager();
      mgr.add({ price: 100, condition: 'below' });
      expect(mgr.check(99, 101)).toHaveLength(0); // upward
      expect(mgr.check(95, 90)).toHaveLength(0); // already below
    });

    it('does not fire on NaN inputs', () => {
      const mgr = new AlertManager();
      mgr.add({ price: 100, condition: 'crossing' });
      expect(mgr.check(NaN, 100)).toHaveLength(0);
      expect(mgr.check(99, NaN)).toHaveLength(0);
    });

    it('does not mutate the input prices (no side effects on prev/new)', () => {
      const mgr = new AlertManager();
      mgr.add({ price: 100, condition: 'crossing' });
      const prev = 99;
      const next = 101;
      mgr.check(prev, next);
      expect(prev).toBe(99);
      expect(next).toBe(101);
    });
  });

  describe('one-shot', () => {
    it('a fired alert is deactivated and does not fire again', () => {
      const mgr = new AlertManager();
      const a = mgr.add({ price: 100, condition: 'crossing' });
      expect(mgr.check(99, 101)).toHaveLength(1);
      expect(a.active).toBe(false);
      // Same crossing again — already disarmed.
      expect(mgr.check(99, 101)).toHaveLength(0);
    });

    it('an inactive alert is skipped entirely by check', () => {
      const mgr = new AlertManager();
      mgr.add({ id: 'x', price: 100, condition: 'crossing' });
      mgr.setActive('x', false);
      expect(mgr.check(99, 101)).toHaveLength(0);
    });

    it('setActive re-arms a fired alert so it can fire again', () => {
      const mgr = new AlertManager();
      const a = mgr.add({ id: 'x', price: 100, condition: 'crossing' });
      mgr.check(99, 101);
      expect(a.active).toBe(false);
      expect(mgr.setActive('x', true)).toBe(true);
      expect(mgr.check(99, 101)).toHaveLength(1);
    });

    it('setActive returns false for an unknown id', () => {
      const mgr = new AlertManager();
      expect(mgr.setActive('nope', true)).toBe(false);
    });

    it('only fires the alerts whose condition matches; others stay active', () => {
      const mgr = new AlertManager();
      const up = mgr.add({ id: 'up', price: 100, condition: 'above' });
      const down = mgr.add({ id: 'down', price: 100, condition: 'below' });
      const fired = mgr.check(99, 101); // upward break
      expect(fired.map((x) => x.id)).toEqual(['up']);
      expect(up.active).toBe(false);
      expect(down.active).toBe(true);
    });
  });

  describe('triggers (static predicate)', () => {
    it('matches the instance semantics', () => {
      expect(AlertManager.triggers('crossing', 100, 99, 101)).toBe(true);
      expect(AlertManager.triggers('crossing', 100, 101, 105)).toBe(false);
      expect(AlertManager.triggers('above', 100, 99, 100)).toBe(true);
      expect(AlertManager.triggers('above', 100, 100, 101)).toBe(false);
      expect(AlertManager.triggers('below', 100, 101, 100)).toBe(true);
      expect(AlertManager.triggers('below', 100, 99, 98)).toBe(false);
    });
  });
});
