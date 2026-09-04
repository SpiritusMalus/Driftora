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
    // kcal FOLLOWS THE MACROS (4·8 + 9·12 + 4·30 = 260) — the typed 250 is not
    // a separate fact the card could contradict itself with.
    expect(it.per100.kcal).toBe(260);
    expect(it.per100.prot).toBe(8);
    // scaled follows current grams (200g → ×2)
    expect(it.scaled.kcal).toBe(520);
    expect(it.scaled.prot).toBe(16);
    expect(d.totals.kcal).toBe(520);
  });

  // ─── калории из БЖУ (отчёт владельца 2026-09-03) ────────────────────────────

  it('kcal is derived from the macros by the one formula — a typed kcal is ignored', () => {
    // A glazed curd bar's label: 8.5 / 27.7 / 32 → 411 by the formula, whatever
    // the person typed (or forgot to type) in the kcal box.
    const typed = withItemManualMacros(draftOf([missItem()]), 0, { kcal: 39, prot: 8.5, fat: 27.7, carb: 32 });
    expect(typed.items[0].per100.kcal).toBe(411);
    const untyped = withItemManualMacros(draftOf([missItem()]), 0, { prot: 8.5, fat: 27.7, carb: 32 });
    expect(untyped.items[0].per100.kcal).toBe(411);
  });

  it('changing one macro moves kcal with it', () => {
    const base = withItemManualMacros(draftOf([missItem()]), 0, { prot: 10, fat: 10, carb: 10 });
    expect(base.items[0].per100.kcal).toBe(170);
    const moreFat = withItemManualMacros(base, 0, { prot: 10, fat: 20, carb: 10 });
    expect(moreFat.items[0].per100.kcal).toBe(260); // +10 g fat = +90 kcal
  });

  it('calories-only entry (a menu) keeps the typed kcal — there is nothing to derive from', () => {
    const d = withItemManualMacros(draftOf([missItem()]), 0, { kcal: 320, prot: 0, fat: 0, carb: 0 });
    expect(d.items[0].per100.kcal).toBe(320);
    expect(d.totals.kcal).toBe(640); // 200 g
  });

  it('fiber is stored only when given and discounts the energy at 2 kcal/g', () => {
    const without = withItemManualMacros(draftOf([missItem()]), 0, { prot: 0, fat: 0, carb: 30 });
    expect(without.items[0].per100.fiber).toBeUndefined();
    expect(without.items[0].per100.kcal).toBe(120);
    const withFiber = withItemManualMacros(draftOf([missItem()]), 0, { prot: 0, fat: 0, carb: 30, fiber: 10 });
    expect(withFiber.items[0].per100.fiber).toBe(10);
    expect(withFiber.items[0].per100.kcal).toBe(100); // 20 × 4 + 10 × 2
    // An explicit 0 is a real zero, not "unknown".
    const zero = withItemManualMacros(draftOf([missItem()]), 0, { prot: 0, fat: 0, carb: 30, fiber: 0 });
    expect(zero.items[0].per100.fiber).toBe(0);
  });

  it('a DB row the user knows better than flips to manual, keeps its grams and rescales', () => {
    // The screenshot case: «Творог» 87 kcal matched for a glazed curd bar. The
    // person types the label's macros — the row becomes theirs, honestly labelled.
    const curd: Per100 = { kcal: 87, prot: 12.9, fat: 2.5, carb: 2.6, minerals: {}, source: 'fatsecret' };
    const item: NutritionItem = { ...dbItem(), per100: curd, grams: 45, matched_name: 'Творог' };
    const d = withItemManualMacros(draftOf([item]), 0, { prot: 8.5, fat: 27.7, carb: 32 });
    expect(d.items[0].per100.source).toBe('manual');
    expect(d.items[0].matched_name).toBeUndefined();
    expect(d.items[0].grams).toBe(45);
    expect(d.items[0].scaled.kcal).toBe(185); // 411 × 0.45
    expect(d.totals.kcal).toBe(185);
  });

  it('clears the draft has_estimate flag once the only miss is filled in', () => {
    const before = draftOf([missItem()]);
    expect(before.flags.has_estimate).toBe(true);
    const after = withItemManualMacros(before, 0, { kcal: 100, prot: 1, fat: 1, carb: 1 });
    expect(after.flags.has_estimate).toBe(false);
  });

  it('floors negatives to 0 and rounds (kcal int, macros 1 dp)', () => {
    const d = withItemManualMacros(draftOf([missItem()]), 0, { kcal: -5, prot: 7.26, fat: -1, carb: 3.04 });
    // kcal follows the rounded macros: 4 × 7.3 + 4 × 3 = 41.2 → 41.
    expect(d.items[0].per100.kcal).toBe(41);
    expect(d.items[0].per100.prot).toBe(7.3);
    expect(d.items[0].per100.fat).toBe(0);
    expect(d.items[0].per100.carb).toBe(3);
    // A negative kcal on a calories-only entry floors to 0 too.
    const only = withItemManualMacros(draftOf([missItem()]), 0, { kcal: -5, prot: 0, fat: 0, carb: 0 });
    expect(only.items[0].per100.kcal).toBe(0);
  });

  it('leaves other items untouched', () => {
    const d = withItemManualMacros(draftOf([dbItem(), missItem()]), 1, { kcal: 90, prot: 2, fat: 0, carb: 20 });
    expect(d.items[0].per100.source).toBe('usda');
    expect(d.items[0].per100.kcal).toBe(200);
    expect(d.items[1].per100.source).toBe('manual');
  });
});
