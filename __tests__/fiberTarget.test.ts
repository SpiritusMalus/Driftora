import { describe, expect, it } from '@jest/globals';

import { FIBER_TARGET_FLOOR_G, fiberTargetG } from '@/lib/core/insights/fiberTarget';

describe('fiberTargetG', () => {
  it('scales with the calorie budget at 12 g per 1000 kcal', () => {
    expect(fiberTargetG(2400)).toBe(29); // 2400 / 1000 × 12 = 28.8 → 29
    expect(fiberTargetG(2800)).toBe(34); // 33.6 → 34
    expect(fiberTargetG(3800)).toBe(46); // 45.6 → 46 (athlete budget)
  });

  it('floors at the EFSA/WHO adult minimum for low budgets', () => {
    expect(fiberTargetG(1500)).toBe(FIBER_TARGET_FLOOR_G); // 18 → floored to 25
    expect(fiberTargetG(2000)).toBe(FIBER_TARGET_FLOOR_G); // 24 → floored to 25
  });

  it('degrades safely on garbage input', () => {
    expect(fiberTargetG(0)).toBe(FIBER_TARGET_FLOOR_G);
    expect(fiberTargetG(-500)).toBe(FIBER_TARGET_FLOOR_G);
    expect(fiberTargetG(NaN)).toBe(FIBER_TARGET_FLOOR_G);
  });
});
