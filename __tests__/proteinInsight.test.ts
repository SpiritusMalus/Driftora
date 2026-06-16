import { describe, expect, it } from '@jest/globals';

import { proteinBand, proteinInsight } from '@/lib/core/insights/proteinInsight';

describe('proteinBand', () => {
  it('treats a 0 target as "unset"', () => {
    expect(proteinBand(100, 0)).toBe('unset');
    expect(proteinBand(0, 0)).toBe('unset');
  });

  it('bands by ratio to the personal target', () => {
    expect(proteinBand(0, 120)).toBe('none');
    expect(proteinBand(40, 120)).toBe('low'); // 0.33
    expect(proteinBand(60, 120)).toBe('building'); // 0.50
    expect(proteinBand(119, 120)).toBe('building');
    expect(proteinBand(120, 120)).toBe('met');
    expect(proteinBand(200, 120)).toBe('met');
  });
});

describe('proteinInsight', () => {
  it('returns a supportive sentence for every band and never mentions calories', () => {
    const cases: [number, number][] = [
      [100, 0],
      [0, 120],
      [40, 120],
      [80, 120],
      [130, 120],
    ];
    for (const [p, target] of cases) {
      const sentence = proteinInsight(p, target);
      expect(sentence.length).toBeGreaterThan(0);
      // ED safeguard: protein copy must not turn into calorie pressure.
      expect(sentence.toLowerCase()).not.toContain('калор');
    }
  });
});
