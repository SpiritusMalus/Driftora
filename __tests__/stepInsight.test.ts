import { describe, expect, it } from '@jest/globals';

import { stepBand, stepInsight } from '@/lib/core/insights/stepInsight';

describe('stepBand', () => {
  it('classifies counts into evidence-based bands', () => {
    expect(stepBand(0)).toBe('none');
    expect(stepBand(1500)).toBe('low');
    expect(stepBand(3500)).toBe('building');
    expect(stepBand(7000)).toBe('beneficial');
    expect(stepBand(12000)).toBe('ample');
  });

  it('older adults reach the plateau earlier', () => {
    expect(stepBand(7000, 65)).toBe('ample');
    expect(stepBand(7000, 30)).toBe('beneficial');
  });
});

describe('stepInsight', () => {
  it('never promotes the 10,000-steps myth', () => {
    for (const steps of [0, 3000, 7000, 9000, 15000]) {
      const s = stepInsight(steps, 7000);
      expect(s).not.toContain('10 000');
      expect(s).not.toContain('10000');
      expect(s.length).toBeGreaterThan(0);
    }
  });

  it('acknowledges hitting the personal goal', () => {
    expect(stepInsight(7200, 7000)).toContain('цель');
  });

  it('is gentle, not shaming, at low counts', () => {
    expect(stepInsight(800, 7000)).not.toContain('провал');
  });
});
