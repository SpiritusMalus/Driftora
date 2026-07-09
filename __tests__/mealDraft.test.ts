import { describe, expect, it } from '@jest/globals';

import type { MealDraft, NutritionItem, Per100 } from '@/lib/core/services/foodParser';
import {
  recomputeDraft,
  removeDraftItem,
  scaleToGrams,
  withItemGrams,
  withItemManualMacros,
  withItemReplacement,
} from '@/lib/core/services/mealDraft';

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

  it('removeDraftItem drops one dish and recomputes the total', () => {
    const d = recomputeDraft('US', [item(), item({ name_ru: 'рис' })]);
    expect(d.totals.kcal).toBe(496); // both dishes
    const after = removeDraftItem(d, 0);
    expect(after.items).toHaveLength(1);
    expect(after.items[0].name_ru).toBe('рис');
    expect(after.totals.kcal).toBe(248); // only the survivor
  });

  it('removeDraftItem is a no-op for an out-of-range index', () => {
    const d = recomputeDraft('US', [item()]);
    expect(removeDraftItem(d, 5).items).toHaveLength(1);
    expect(removeDraftItem(d, -1).items).toHaveLength(1);
  });

  it('stays approximate while any item is still estimated', () => {
    const d = recomputeDraft('US', [item(), item({ name_ru: 'рис' })]);
    const after = withItemGrams(d, 0, 100);
    expect(after.items[0].approximate).toBe(false);
    expect(after.items[1].approximate).toBe(true);
    expect(after.approximate).toBe(true);
  });

  it('excludes unfilled DB-miss items from the total (no fabricated macros)', () => {
    const miss: Per100 = { source: 'estimate', kcal: 150, prot: 5, fat: 5, carb: 20, minerals: {} };
    const d = recomputeDraft('RU', [
      item({ name_ru: 'курица', grams: 100, scaled: scaleToGrams(chicken, 100) }),
      item({ name_ru: 'пончик', per100: miss, scaled: scaleToGrams(miss, 200), grams: 200 }),
    ]);
    // The miss is present (flag set) but its 300 kcal placeholder is NOT in the total.
    expect(d.flags.has_estimate).toBe(true);
    expect(d.totals.kcal).toBe(165); // chicken only — donut excluded
  });

  it('confirming grams preserves the server dry_basis / micros_estimated hints', () => {
    const d = recomputeDraft('RU', [item({ dry_basis: true, micros_estimated: true })]);
    const after = withItemGrams(d, 0, 200);
    // The food didn't change — only its weight — so the hints still describe it.
    expect(after.items[0].dry_basis).toBe(true);
    expect(after.items[0].micros_estimated).toBe(true);
  });

  it('typing manual macros drops the dry_basis / micros_estimated hints (new numbers)', () => {
    const d = recomputeDraft('RU', [item({ dry_basis: true, micros_estimated: true })]);
    const after = withItemManualMacros(d, 0, { kcal: 120, prot: 4, fat: 2, carb: 20 });
    expect(after.items[0].per100.source).toBe('manual');
    expect(after.items[0].dry_basis).toBeUndefined();
    expect(after.items[0].micros_estimated).toBeUndefined();
  });

  it('replacing the match drops the old row hints (user took control)', () => {
    const cooked: Per100 = { source: 'skurikhin', kcal: 120, prot: 4, fat: 2, carb: 20, minerals: {} };
    const d = recomputeDraft('RU', [item({ dry_basis: true, micros_estimated: true })]);
    const after = withItemReplacement(d, 0, { name: 'лапша готовая', per100: cooked });
    expect(after.items[0].matched_name).toBe('лапша готовая');
    expect(after.items[0].dry_basis).toBeUndefined();
    expect(after.items[0].micros_estimated).toBeUndefined();
  });
});
