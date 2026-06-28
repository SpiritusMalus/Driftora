import {
  applyCookFactor,
  isNeutralCookMethod,
  type CookMethod,
} from '../insights/cookMethod';
import type {
  MealDraft,
  Minerals,
  NutrientValues,
  NutritionItem,
  Per100,
  Region,
} from './foodParser';

/// Mirrors the server's math (server/src/types.ts) so the client can recompute
/// totals live as the user confirms grams — without another round-trip.

const MINERAL_KEYS: readonly (keyof Minerals)[] = ['na', 'k', 'ca', 'mg', 'fe', 'zn'];
const LOW_CONFIDENCE_FLOOR = 0.5;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/// Scale a per-100g block to `grams` (minerals to whole mg).
export function scaleToGrams(per100: NutrientValues, grams: number): NutrientValues {
  const factor = Math.max(0, grams) / 100;
  const minerals: Minerals = {};
  for (const key of MINERAL_KEYS) {
    const v = per100.minerals[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      minerals[key] = Math.round(v * factor);
    }
  }
  return {
    kcal: Math.round(per100.kcal * factor),
    prot: round1(per100.prot * factor),
    fat: round1(per100.fat * factor),
    carb: round1(per100.carb * factor),
    minerals,
  };
}

/// Sum scaled component values into a single totals block.
export function sumNutrients(items: { scaled: NutrientValues }[]): NutrientValues {
  const minerals: Minerals = {};
  let kcal = 0;
  let prot = 0;
  let fat = 0;
  let carb = 0;
  for (const it of items) {
    kcal += it.scaled.kcal;
    prot += it.scaled.prot;
    fat += it.scaled.fat;
    carb += it.scaled.carb;
    for (const key of MINERAL_KEYS) {
      const v = it.scaled.minerals[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        minerals[key] = (minerals[key] ?? 0) + v;
      }
    }
  }
  return { kcal: Math.round(kcal), prot: round1(prot), fat: round1(fat), carb: round1(carb), minerals };
}

/// Rebuild totals/flags/approximate from the current items.
export function recomputeDraft(region: Region, items: NutritionItem[]): MealDraft {
  const approximate = items.some((it) => it.approximate);
  return {
    region,
    items,
    totals: sumNutrients(items),
    portion_state: approximate ? 'estimated' : 'confirmed',
    approximate,
    flags: {
      has_estimate: items.some((it) => it.per100.source === 'estimate'),
      low_confidence: items.some((it) => it.confidence < LOW_CONFIDENCE_FLOOR),
    },
  };
}

/// Set user-entered per-100g macros for one item (a DB miss the user is filling
/// in by hand) and recompute. The source becomes the honest `'manual'` label —
/// never a fabricated DB number — and the scaled total follows the current grams.
/// Macros only (minerals stay empty for v1); negatives are floored to 0.
export function withItemManualMacros(
  draft: MealDraft,
  index: number,
  macros: { kcal: number; prot: number; fat: number; carb: number },
): MealDraft {
  const items = draft.items.map((it, i) => {
    if (i !== index) return it;
    const per100: Per100 = {
      kcal: Math.max(0, Math.round(macros.kcal)),
      prot: Math.max(0, round1(macros.prot)),
      fat: Math.max(0, round1(macros.fat)),
      carb: Math.max(0, round1(macros.carb)),
      minerals: {},
      source: 'manual',
    };
    return { ...it, per100, scaled: scaleToGrams(per100, it.grams) };
  });
  return recomputeDraft(draft.region, items);
}

/// Set a confirmed weight for one item and recompute everything. Confirming
/// grams flips that item (and, once all are confirmed, the whole draft) out of
/// the "approximate" state — the total is now DB × confirmed weight.
export function withItemGrams(draft: MealDraft, index: number, grams: number): MealDraft {
  const g = Math.max(0, grams);
  const items = draft.items.map((it, i) =>
    i === index
      ? { ...it, grams: g, grams_source: 'confirmed' as const, approximate: false, scaled: scaleToGrams(it.per100, g) }
      : it,
  );
  return recomputeDraft(draft.region, items);
}

/// Switch one item's cooking method and recompute everything, OFFLINE. The DB
/// row is the `raw` baseline (captured once in `basePer100`); a non-neutral
/// method applies coarse factors and honestly raises `approximate`, while
/// switching back to a neutral method (raw/boiled) restores the grams-based
/// state. Reversible because we always recompute from `basePer100`, never from
/// the already-adjusted per100.
export function withItemCookMethod(draft: MealDraft, index: number, method: CookMethod): MealDraft {
  const items = draft.items.map((it, i) => {
    if (i !== index) return it;
    const base = it.basePer100 ?? it.per100;
    const per100 = applyCookFactor(base, method);
    const neutral = isNeutralCookMethod(method);
    return {
      ...it,
      basePer100: base,
      cook_method: method,
      per100,
      // Coarse method factors → estimate; neutral methods fall back to the
      // item's grams-confirmation state.
      approximate: neutral ? it.grams_source === 'estimated' : true,
      scaled: scaleToGrams(per100, it.grams),
    };
  });
  return recomputeDraft(draft.region, items);
}
