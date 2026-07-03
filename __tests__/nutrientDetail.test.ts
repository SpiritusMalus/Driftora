import { describe, expect, it } from '@jest/globals';

import { nutrientDetailRows } from '@/lib/core/insights/nutrientDetail';
import { scaleToGrams, sumNutrients } from '@/lib/core/services/mealDraft';
import type { NutrientValues, Per100 } from '@/lib/core/services/foodParser';

const roll: Per100 = {
  source: 'usda',
  kcal: 309,
  prot: 10.84,
  fat: 6.44,
  carb: 51.92,
  fiber: 2,
  sugar: 5.42,
  satFat: 1.55,
  minerals: { na: 547, k: 140 },
};

describe('nutrientDetailRows', () => {
  it('lists extended-label fields first, then non-zero minerals', () => {
    const rows = nutrientDetailRows(roll);
    expect(rows.map((r) => r.key)).toEqual(['fiber', 'sugar', 'satFat', 'na', 'k']);
    expect(rows[0]).toEqual({ key: 'fiber', value: 2, unit: 'g' });
    expect(rows[3]).toEqual({ key: 'na', value: 547, unit: 'mg' });
  });

  it('shows a REAL zero for extras but hides zero-mg mineral noise', () => {
    const v: NutrientValues = { kcal: 231, prot: 0, fat: 0, carb: 0, sugar: 0, minerals: { na: 0 } };
    const rows = nutrientDetailRows(v);
    expect(rows).toEqual([{ key: 'sugar', value: 0, unit: 'g' }]);
  });

  it('is empty when the source gave only КБЖУ — the UI hides the section', () => {
    const v: NutrientValues = { kcal: 49, prot: 1.1, fat: 2.2, carb: 6.7, minerals: {} };
    expect(nutrientDetailRows(v)).toEqual([]);
  });
});

describe('extended label through scaling and totals', () => {
  it('scaleToGrams scales extras and keeps absent fields absent', () => {
    const scaled = scaleToGrams(roll, 60);
    expect(scaled.fiber).toBe(1.2);
    expect(scaled.sugar).toBe(3.3); // 5.42 × 0.6 = 3.252 → 3.3
    expect(scaled.satFat).toBe(0.9);

    const bare = scaleToGrams({ ...roll, fiber: undefined, sugar: undefined, satFat: undefined }, 60);
    expect(bare.fiber).toBeUndefined();
    expect(bare.sugar).toBeUndefined();
  });

  it('sumNutrients partial-sums extras over items that have them', () => {
    const withExtras = { scaled: scaleToGrams(roll, 100) };
    const without = { scaled: { kcal: 49, prot: 1.1, fat: 2.2, carb: 6.7, minerals: {} } };
    const totals = sumNutrients([withExtras, without]);
    expect(totals.fiber).toBe(2);
    expect(totals.sugar).toBe(5.4);
    // No item had the field → the total must not fabricate it.
    expect(sumNutrients([without]).fiber).toBeUndefined();
  });
});
