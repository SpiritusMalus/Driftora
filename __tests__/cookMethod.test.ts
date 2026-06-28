import { describe, expect, it } from '@jest/globals';

import {
  applyCookFactor,
  COOK_METHODS,
  isNeutralCookMethod,
} from '@/lib/core/insights/cookMethod';
import { withItemCookMethod } from '@/lib/core/services/mealDraft';
import type { MealDraft, NutritionItem, Per100 } from '@/lib/core/services/foodParser';

const base: Per100 = { kcal: 200, prot: 20, fat: 10, carb: 5, minerals: { k: 300 }, source: 'usda' };

function item(): NutritionItem {
  return {
    name_ru: 'курица',
    name_en: 'chicken',
    grams: 100,
    grams_source: 'confirmed',
    confidence: 0.9,
    per100: { ...base },
    scaled: { kcal: 200, prot: 20, fat: 10, carb: 5, minerals: { k: 300 } },
    approximate: false,
  };
}

function draftOf(it: NutritionItem): MealDraft {
  return {
    region: 'RU',
    items: [it],
    totals: { ...it.scaled },
    portion_state: 'confirmed',
    approximate: false,
    flags: { has_estimate: false, low_confidence: false },
  };
}

describe('cookMethod factors', () => {
  it('raw and boiled are neutral (identity); others are not', () => {
    expect(isNeutralCookMethod('raw')).toBe(true);
    expect(isNeutralCookMethod('boiled')).toBe(true);
    expect(isNeutralCookMethod('fried')).toBe(false);
    expect(isNeutralCookMethod('baked')).toBe(false);
  });

  it('raw is the identity transform', () => {
    expect(applyCookFactor(base, 'raw')).toEqual(base);
  });

  it('frying raises kcal and fat deterministically, leaves prot/carb', () => {
    const fried = applyCookFactor(base, 'fried');
    expect(fried.kcal).toBe(280); // 200 * 1.4
    expect(fried.fat).toBe(18); // 10 * 1.8
    expect(fried.prot).toBe(20);
    expect(fried.carb).toBe(5);
    expect(fried.source).toBe('usda'); // source passes through
    expect(applyCookFactor(base, 'fried')).toEqual(fried); // deterministic
  });
});

describe('withItemCookMethod', () => {
  it('captures basePer100 and recomputes per100 + scaled for the chosen method', () => {
    const d = withItemCookMethod(draftOf(item()), 0, 'fried');
    const it = d.items[0];
    expect(it.cook_method).toBe('fried');
    expect(it.basePer100).toEqual(base);
    expect(it.per100.kcal).toBe(280);
    expect(it.scaled.kcal).toBe(280); // grams 100 → per100 == scaled
    expect(d.totals.kcal).toBe(280);
  });

  it('non-neutral method marks the item + draft approximate', () => {
    const d = withItemCookMethod(draftOf(item()), 0, 'fried');
    expect(d.items[0].approximate).toBe(true);
    expect(d.approximate).toBe(true);
    expect(d.portion_state).toBe('estimated');
  });

  it('switching back to a neutral method restores the baseline numbers', () => {
    const fried = withItemCookMethod(draftOf(item()), 0, 'fried');
    const back = withItemCookMethod(fried, 0, 'raw');
    expect(back.items[0].per100).toEqual(base);
    expect(back.items[0].scaled.kcal).toBe(200);
    expect(back.totals.kcal).toBe(200);
    // grams were confirmed → neutral method drops approximate again
    expect(back.items[0].approximate).toBe(false);
    expect(back.approximate).toBe(false);
  });

  it('always recomputes from base, so method switches are reversible', () => {
    let d = draftOf(item());
    for (const m of COOK_METHODS) d = withItemCookMethod(d, 0, m);
    const finalFromChain = withItemCookMethod(d, 0, 'fried').items[0].per100;
    const finalFresh = withItemCookMethod(draftOf(item()), 0, 'fried').items[0].per100;
    expect(finalFromChain).toEqual(finalFresh);
  });

  it('a still-estimated item stays approximate even on a neutral method', () => {
    const est = item();
    est.grams_source = 'estimated';
    est.approximate = true;
    const back = withItemCookMethod(draftOf(est), 0, 'boiled');
    expect(back.items[0].approximate).toBe(true);
  });
});
