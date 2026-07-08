import { describe, expect, it } from '@jest/globals';

import type { MealDraft, NutritionItem, Per100 } from '@/lib/core/services/foodParser';
import { withItemAlternative, withItemReplacement } from '@/lib/core/services/mealDraft';

function per100(kcal: number, source: Per100['source'] = 'fatsecret'): Per100 {
  return { kcal, prot: 10, fat: 1, carb: 2, minerals: {}, source };
}

function draftWithAlternatives(): MealDraft {
  const item: NutritionItem = {
    name_ru: 'творог',
    name_en: 'cottage cheese',
    grams: 200,
    grams_source: 'estimated',
    confidence: 0.4, // low — picker would show proactively
    per100: per100(150), // current primary (e.g. a branded match)
    scaled: { kcal: 300, prot: 20, fat: 2, carb: 4, minerals: {} },
    approximate: true,
    alternatives: [
      { name: 'Творог 5%', per100: per100(121) },
      { name: 'Творог 9%', per100: per100(159) },
    ],
  };
  return {
    region: 'RU',
    items: [item],
    totals: { kcal: 300, prot: 20, fat: 2, carb: 4, minerals: {} },
    portion_state: 'estimated',
    approximate: true,
    flags: { has_estimate: false, low_confidence: true },
  };
}

describe('withItemAlternative', () => {
  it('swaps per100 to the chosen candidate and recomputes scaled + totals', () => {
    const next = withItemAlternative(draftWithAlternatives(), 0, 0); // pick "Творог 5%" (121)
    const it = next.items[0]!;
    expect(it.per100.kcal).toBe(121);
    // scaled = 121 * 200 / 100 = 242
    expect(it.scaled.kcal).toBe(242);
    expect(next.totals.kcal).toBe(242);
  });

  it('treats the explicit pick as confident (clears the low-confidence flag)', () => {
    const next = withItemAlternative(draftWithAlternatives(), 0, 0);
    expect(next.items[0]!.confidence).toBe(1);
    expect(next.flags.low_confidence).toBe(false);
  });

  it('keeps the swap reversible: the previous match drops back into alternatives', () => {
    const next = withItemAlternative(draftWithAlternatives(), 0, 0);
    const alts = next.items[0]!.alternatives!;
    // previous primary (150) is now an option; the other candidate (159) remains.
    expect(alts.map((a) => a.per100.kcal)).toEqual([150, 159]);
    expect(alts).toHaveLength(2);
    // swapping back restores the original 150.
    const back = withItemAlternative(next, 0, 0);
    expect(back.items[0]!.per100.kcal).toBe(150);
  });

  it('is a no-op for an out-of-range alternative index', () => {
    const next = withItemAlternative(draftWithAlternatives(), 0, 9);
    expect(next.items[0]!.per100.kcal).toBe(150);
  });

  it('keeps matched_name honest through a swap (transparency)', () => {
    const seeded = draftWithAlternatives();
    seeded.items[0]!.matched_name = 'Творог зернёный (бренд)';
    const next = withItemAlternative(seeded, 0, 0); // pick «Творог 5%»
    const it = next.items[0]!;
    expect(it.matched_name).toBe('Творог 5%');
    // The swapped-out row went back under its OWN name, not the component's.
    expect(it.alternatives?.[0]?.name).toBe('Творог зернёный (бренд)');
  });

  it('previous match returns under its own DB row for a reversible swap', () => {
    const seeded = draftWithAlternatives();
    seeded.items[0]!.per100 = per100(150);
    const next = withItemAlternative(seeded, 0, 0);
    expect(next.items[0]!.alternatives?.[0]?.per100.kcal).toBe(150);
  });
});

describe('withItemReplacement (manual search pick)', () => {
  it('replaces per100 with the searched candidate and recomputes confidently', () => {
    const replacement = { name: 'Творог обезжиренный', per100: per100(71) };
    const next = withItemReplacement(draftWithAlternatives(), 0, replacement);
    const it = next.items[0]!;
    expect(it.per100.kcal).toBe(71);
    expect(it.scaled.kcal).toBe(142); // 71 * 200 / 100
    expect(it.confidence).toBe(1);
    expect(next.flags.low_confidence).toBe(false);
    // the previous match is preserved so the swap is reversible.
    expect(it.alternatives?.[0]?.per100.kcal).toBe(150);
  });
});
