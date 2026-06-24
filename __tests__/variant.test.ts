import { describe, expect, it } from '@jest/globals';

import { dayOfYear, pickVariant, stableSeed } from '@/lib/core/insights/variant';

describe('pickVariant', () => {
  it('is deterministic: same seed → same pick', () => {
    const v = ['a', 'b', 'c'] as const;
    expect(pickVariant(v, 7)).toBe(pickVariant(v, 7));
  });

  it('indexes by seed % length', () => {
    const v = ['a', 'b', 'c'] as const;
    expect(pickVariant(v, 0)).toBe('a');
    expect(pickVariant(v, 1)).toBe('b');
    expect(pickVariant(v, 2)).toBe('c');
    expect(pickVariant(v, 3)).toBe('a');
  });

  it('returns the sole element for a single-variant array (byte-identical legacy)', () => {
    expect(pickVariant(['only'], 0)).toBe('only');
    expect(pickVariant(['only'], 999)).toBe('only');
  });

  it('normalizes negative / non-finite seeds into range', () => {
    const v = ['a', 'b', 'c'] as const;
    expect(v).toContain(pickVariant(v, -1));
    expect(v).toContain(pickVariant(v, -4));
    expect(v).toContain(pickVariant(v, NaN));
    expect(v).toContain(pickVariant(v, Infinity));
  });

  it('throws on an empty array', () => {
    expect(() => pickVariant([], 0)).toThrow();
  });

  it('spreads picks across the whole set as the seed walks', () => {
    const v = ['a', 'b', 'c', 'd'] as const;
    const seen = new Set<string>();
    for (let s = 0; s < 8; s++) seen.add(pickVariant(v, s));
    expect(seen.size).toBe(4);
  });
});

describe('dayOfYear', () => {
  it('is 1 on Jan 1 and increments by day', () => {
    expect(dayOfYear(new Date(2026, 0, 1, 12))).toBe(1);
    expect(dayOfYear(new Date(2026, 0, 2, 12))).toBe(2);
  });

  it('is stable within a day regardless of clock time', () => {
    expect(dayOfYear(new Date(2026, 5, 24, 0, 1))).toBe(
      dayOfYear(new Date(2026, 5, 24, 23, 59)),
    );
  });
});

describe('stableSeed', () => {
  it('is deterministic and order-sensitive', () => {
    expect(stableSeed(1, 2, 3)).toBe(stableSeed(1, 2, 3));
    expect(stableSeed(1, 2)).not.toBe(stableSeed(2, 1));
  });

  it('returns a non-negative integer usable as a seed', () => {
    const s = stableSeed(170, 4);
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
  });
});
