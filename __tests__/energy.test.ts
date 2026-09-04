import { describe, expect, it } from '@jest/globals';

import { ATWATER, energyFromMacros } from '@/lib/core/services/energy';

/// The client mirror of server/src/nutrition/energy.ts — the same numbers the
/// server's own energy.test.ts pins, so the two copies can't drift apart.
describe('energyFromMacros (single formula, ТР ТС 022/2011)', () => {
  it('general Atwater on plain macros', () => {
    expect(energyFromMacros({ prot: 10, fat: 10, carb: 10 })).toBe(170); // 40 + 90 + 40
    expect(energyFromMacros({ prot: 0, fat: 0, carb: 0 })).toBe(0);
  });

  it('fiber billed at 2 kcal/g, carved out of total carb', () => {
    // 30 g total carb, 10 of it fiber → 20 × 4 + 10 × 2.
    expect(energyFromMacros({ prot: 0, fat: 0, carb: 30, fiber: 10 })).toBe(100);
    // Fiber equal to carb → all of it at 2.
    expect(energyFromMacros({ prot: 0, fat: 0, carb: 10, fiber: 10 })).toBe(20);
    // Fiber above carb (a label listing fiber outside carbs) never goes negative.
    expect(energyFromMacros({ prot: 0, fat: 0, carb: 5, fiber: 10 })).toBe(20);
  });

  it('garbage and negatives read as 0, never as energy', () => {
    expect(energyFromMacros({ prot: -5, fat: Number.NaN, carb: Number.POSITIVE_INFINITY })).toBe(0);
    expect(energyFromMacros({ prot: 10, fat: 0, carb: 0, fiber: -3 })).toBe(40);
  });

  it('the glazed curd bar that started this: Skurikhin macros land on the printed kcal', () => {
    // 8.5 / 27.7 / 32 → 411, against the table's measured 407 (dairy fat at
    // 8.79 rather than 9): inside the «≈» band, as the boundary comment says.
    const kcal = energyFromMacros({ prot: 8.5, fat: 27.7, carb: 32 });
    expect(Math.abs(kcal - 407)).toBeLessThan(10);
  });

  it('factors are the ТР ТС ones', () => {
    expect(ATWATER).toEqual({ prot: 4, fat: 9, carb: 4, fiber: 2 });
  });
});
