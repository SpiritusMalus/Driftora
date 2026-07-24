import { describe, expect, it } from '@jest/globals';

import { defaultPortionG, estimatePortion, portionUncertainty } from '@/lib/core/services/portionPriors';

describe('portionPriors', () => {
  it('falls back to the category default serving when no volume is known', () => {
    expect(estimatePortion('meat')).toEqual({ grams: 85, uncertainty: 0.22 });
    expect(estimatePortion('soup')).toEqual({ grams: 245, uncertainty: 0.22 });
    expect(defaultPortionG('bread')).toBe(50);
  });

  it('converts an estimated volume to mass via the category density', () => {
    // 1 cup (240 mL) of cooked grain at 0.68 g/mL ≈ 163 g.
    expect(estimatePortion('grainCooked', { volumeMl: 240 }).grams).toBe(163);
    // A bowl (~350 mL) of an unidentified mixed dish at 0.85 g/mL.
    expect(estimatePortion('mixedDish', { volumeMl: 350 }).grams).toBe(298);
  });

  it('carries the honest uncertainty band — widest for sauces, tight for discrete items', () => {
    expect(portionUncertainty('sauce')).toBe(0.75); // visually near-unestimable
    expect(portionUncertainty('bread')).toBe(0.18); // discrete/countable
    expect(portionUncertainty('mixedDish')).toBeGreaterThan(portionUncertainty('fruit'));
  });

  it('ignores a garbage volume and returns the default', () => {
    expect(estimatePortion('vegetable', { volumeMl: -10 }).grams).toBe(85);
    expect(estimatePortion('vegetable', { volumeMl: NaN }).grams).toBe(85);
  });
});
