import { describe, expect, it } from '@jest/globals';

import { withItemManualMacros } from '@/lib/core/services/mealDraft';
import type { MealDraft, NutritionItem, Per100 } from '@/lib/core/services/foodParser';

function missItem(): NutritionItem {
  // What the resolver hands back on a full DB miss: the coarse 5-5-20 placeholder.
  const per100: Per100 = { kcal: 150, prot: 5, fat: 5, carb: 20, minerals: {}, source: 'estimate' };
  return {
    name_ru: 'экзотика',
    name_en: 'exotic',
    grams: 200,
    grams_source: 'estimated',
    confidence: 0.3,
    per100,
    scaled: { kcal: 300, prot: 10, fat: 10, carb: 40, minerals: {} },
    approximate: true,
  };
}

function dbItem(): NutritionItem {
  const per100: Per100 = { kcal: 200, prot: 20, fat: 10, carb: 0, minerals: {}, source: 'usda' };
  return {
    name_ru: 'курица',
    name_en: 'chicken',
    grams: 100,
    grams_source: 'confirmed',
    confidence: 0.9,
    per100,
    scaled: { kcal: 200, prot: 20, fat: 10, carb: 0, minerals: {} },
    approximate: false,
  };
}

function draftOf(items: NutritionItem[]): MealDraft {
  return {
    region: 'RU',
    items,
    totals: { kcal: 0, prot: 0, fat: 0, carb: 0, minerals: {} },
    portion_state: 'estimated',
    approximate: items.some((i) => i.approximate),
    flags: { has_estimate: items.some((i) => i.per100.source === 'estimate'), low_confidence: false },
  };
}

describe('withItemManualMacros', () => {
  it('clears matched_name — user-typed numbers are no DB row', () => {
    const seeded = missItem();
    seeded.matched_name = 'что-то из базы';
    const d = withItemManualMacros(draftOf([seeded]), 0, { kcal: 250, prot: 8, fat: 12, carb: 30 });
    expect(d.items[0]!.matched_name).toBeUndefined();
  });

  it('replaces a DB-miss per100 with user numbers tagged source "manual"', () => {
    const d = withItemManualMacros(draftOf([missItem()]), 0, { kcal: 250, prot: 8, fat: 12, carb: 30 });
    const it = d.items[0];
    expect(it.per100.source).toBe('manual');
    expect(it.per100.kcal).toBe(250);
    expect(it.per100.prot).toBe(8);
    // scaled follows current grams (200g → ×2)
    expect(it.scaled.kcal).toBe(500);
    expect(it.scaled.prot).toBe(16);
    expect(d.totals.kcal).toBe(500);
  });

  it('clears the draft has_estimate flag once the only miss is filled in', () => {
    const before = draftOf([missItem()]);
    expect(before.flags.has_estimate).toBe(true);
    const after = withItemManualMacros(before, 0, { kcal: 100, prot: 1, fat: 1, carb: 1 });
    expect(after.flags.has_estimate).toBe(false);
  });

  it('floors negatives to 0 and rounds (kcal int, macros 1 dp)', () => {
    const d = withItemManualMacros(draftOf([missItem()]), 0, { kcal: -5, prot: 7.26, fat: -1, carb: 3.04 });
    expect(d.items[0].per100.kcal).toBe(0);
    expect(d.items[0].per100.prot).toBe(7.3);
    expect(d.items[0].per100.fat).toBe(0);
    expect(d.items[0].per100.carb).toBe(3);
  });

  it('leaves other items untouched', () => {
    const d = withItemManualMacros(draftOf([dbItem(), missItem()]), 1, { kcal: 90, prot: 2, fat: 0, carb: 20 });
    expect(d.items[0].per100.source).toBe('usda');
    expect(d.items[0].per100.kcal).toBe(200);
    expect(d.items[1].per100.source).toBe('manual');
  });
});
