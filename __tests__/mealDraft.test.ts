import { describe, expect, it } from '@jest/globals';

import type { MealDraft, NutritionItem, Per100 } from '@/lib/core/services/foodParser';
import { recomputeDraft, scaleToGrams, withItemGrams } from '@/lib/core/services/mealDraft';

const chicken: Per100 = { source: 'usda', kcal: 165, prot: 31, fat: 3.6, carb: 0, minerals: { na: 74, k: 256 } };

function item(over: Partial<NutritionItem> = {}): NutritionItem {
  return {
    name_ru: 'курица',
    name_en: 'chicken',
    grams: 150,
    grams_source: 'estimated',
    confidence: 0.9,
    per100: chicken,
    scaled: scaleToGrams(chicken, 150),
    approximate: true,
    ...over,
  };
}

describe('mealDraft', () => {
  it('scaleToGrams scales per-100g and rounds minerals to mg', () => {
    const s = scaleToGrams(chicken, 150);
    expect(s.kcal).toBe(248);
    expect(s.prot).toBe(46.5);
    expect(s.minerals).toEqual({ na: 111, k: 384 });
  });

  it('a draft with an estimated item is approximate', () => {
    const d = recomputeDraft('US', [item()]);
    expect(d.approximate).toBe(true);
    expect(d.portion_state).toBe('estimated');
    expect(d.totals.kcal).toBe(248);
  });

  it('confirming grams recomputes the item and clears approximate', () => {
    const before: MealDraft = recomputeDraft('US', [item()]);
    const after = withItemGrams(before, 0, 200);

    expect(after.items[0].grams).toBe(200);
    expect(after.items[0].grams_source).toBe('confirmed');
    expect(after.items[0].approximate).toBe(false);
    expect(after.items[0].scaled.kcal).toBe(330); // 165 * 2
    // Single item now confirmed → the whole draft is exact.
    expect(after.approximate).toBe(false);
    expect(after.portion_state).toBe('confirmed');
    expect(after.totals.kcal).toBe(330);
  });

  it('stays approximate while any item is still estimated', () => {
    const d = recomputeDraft('US', [item(), item({ name_ru: 'рис' })]);
    const after = withItemGrams(d, 0, 100);
    expect(after.items[0].approximate).toBe(false);
    expect(after.items[1].approximate).toBe(true);
    expect(after.approximate).toBe(true);
  });
});
