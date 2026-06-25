import { describe, expect, it } from '@jest/globals';

import { varietyBand, varietyInsight } from '@/lib/core/insights/varietyInsight';

describe('varietyInsight (A5)', () => {
  it('bands distinct-item counts: none / some / varied', () => {
    expect(varietyBand(0)).toBe('none');
    expect(varietyBand(-3)).toBe('none'); // defensive
    expect(varietyBand(1)).toBe('some');
    expect(varietyBand(2)).toBe('some');
    expect(varietyBand(3)).toBe('varied');
    expect(varietyBand(9)).toBe('varied');
  });

  it('returns a non-empty sentence for every band', () => {
    for (const n of [0, 1, 2, 3, 7]) {
      expect(typeof varietyInsight(n)).toBe('string');
      expect(varietyInsight(n).length).toBeGreaterThan(0);
    }
  });

  it('is ED-safe: never frames amounts, limits, or calories', () => {
    const unsafe = /(калори|ккал|больше|меньше|лимит|норм[аы]|съешь|kcal|calorie|more|less|limit)/i;
    for (const n of [0, 1, 2, 3, 7]) {
      expect(varietyInsight(n)).not.toMatch(unsafe);
    }
  });

  it('is deterministic for a given count', () => {
    expect(varietyInsight(4)).toBe(varietyInsight(4));
  });
});
