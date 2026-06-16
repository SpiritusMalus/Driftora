import { describe, expect, it } from '@jest/globals';

import { stepReference, stepStanding } from '@/lib/core/insights/stepNorms';

describe('stepStanding', () => {
  it('classifies a weekly average against the evidence reference (default age)', () => {
    expect(stepStanding(0)).toBe('building');
    expect(stepStanding(3000)).toBe('building');
    expect(stepStanding(5000)).toBe('approaching');
    expect(stepStanding(6999)).toBe('approaching');
    expect(stepStanding(7000)).toBe('beneficial');
    expect(stepStanding(8999)).toBe('beneficial');
    expect(stepStanding(9000)).toBe('ample'); // default plateau is 9000
  });

  it('uses an age-aware plateau (60+ tops out lower)', () => {
    expect(stepStanding(7000, 65)).toBe('ample'); // 60+ plateau is 7000
    expect(stepStanding(6500, 65)).toBe('approaching');
  });
});

describe('stepReference', () => {
  it('returns null when there is no step average yet', () => {
    expect(stepReference(0)).toBeNull();
  });

  it('reports the achievable gap to the beneficial reference', () => {
    expect(stepReference(5500)).toEqual({
      weeklyAvg: 5500,
      beneficial: 7000,
      standing: 'approaching',
      gapToBeneficial: 1500,
    });
    expect(stepReference(8000)?.gapToBeneficial).toBe(0); // already past it
  });
});
