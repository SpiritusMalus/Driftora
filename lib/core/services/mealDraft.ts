import type {
  MealDraft,
  Minerals,
  NutritionAlternative,
  NutrientValues,
  NutritionItem,
  Per100,
  Region,
  Vitamins,
} from './foodParser';

/// Mirrors the server's math (server/src/types.ts) so the client can recompute
/// totals live as the user confirms grams — without another round-trip.

const MINERAL_KEYS: readonly (keyof Minerals)[] = ['na', 'k', 'ca', 'mg', 'fe', 'zn'];
const VITAMIN_KEYS: readonly (keyof Vitamins)[] = ['a', 'd', 'e', 'c', 'b1', 'b2', 'b6', 'b9', 'b12'];
const EXTRA_KEYS = ['fiber', 'sugar', 'satFat'] as const;
const LOW_CONFIDENCE_FLOOR = 0.5;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/// Vitamins are often sub-milligram — keep 2 decimals so a real trace amount
/// doesn't round to a fake zero (mirrors server round2).
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function scaleVitamins(vitamins: Vitamins | undefined, factor: number): Vitamins | undefined {
  if (!vitamins) return undefined;
  const out: Vitamins = {};
  let any = false;
  for (const key of VITAMIN_KEYS) {
    const v = vitamins[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[key] = round2(v * factor);
      any = true;
    }
  }
  return any ? out : undefined;
}

/// Scale a per-100g block to `grams` (minerals to whole mg, vitamins to 2 dp).
export function scaleToGrams(per100: NutrientValues, grams: number): NutrientValues {
  const factor = Math.max(0, grams) / 100;
  const minerals: Minerals = {};
  for (const key of MINERAL_KEYS) {
    const v = per100.minerals[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      minerals[key] = Math.round(v * factor);
    }
  }
  const out: NutrientValues = {
    kcal: Math.round(per100.kcal * factor),
    prot: round1(per100.prot * factor),
    fat: round1(per100.fat * factor),
    carb: round1(per100.carb * factor),
    minerals,
  };
  for (const key of EXTRA_KEYS) {
    const v = per100[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = round1(v * factor);
  }
  const vitamins = scaleVitamins(per100.vitamins, factor);
  if (vitamins) out.vitamins = vitamins;
  return out;
}

/// Sum scaled component values into a single totals block.
export function sumNutrients(items: { scaled: NutrientValues }[]): NutrientValues {
  const minerals: Minerals = {};
  const vitamins: Vitamins = {};
  let anyVitamin = false;
  let kcal = 0;
  let prot = 0;
  let fat = 0;
  let carb = 0;
  // Extras sum like minerals do: over the items that HAVE the field (an
  // "at least this much" partial sum — the UI says so).
  const extras: Partial<Record<(typeof EXTRA_KEYS)[number], number>> = {};
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
    for (const key of VITAMIN_KEYS) {
      const v = it.scaled.vitamins?.[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        vitamins[key] = (vitamins[key] ?? 0) + v;
        anyVitamin = true;
      }
    }
    for (const key of EXTRA_KEYS) {
      const v = it.scaled[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        extras[key] = (extras[key] ?? 0) + v;
      }
    }
  }
  const out: NutrientValues = { kcal: Math.round(kcal), prot: round1(prot), fat: round1(fat), carb: round1(carb), minerals };
  for (const key of EXTRA_KEYS) {
    const v = extras[key];
    if (v !== undefined) out[key] = round1(v);
  }
  if (anyVitamin) {
    for (const key of VITAMIN_KEYS) {
      if (vitamins[key] !== undefined) vitamins[key] = round2(vitamins[key]!);
    }
    out.vitamins = vitamins;
  }
  return out;
}

/// Rebuild totals/flags/approximate from the current items.
export function recomputeDraft(region: Region, items: NutritionItem[]): MealDraft {
  const approximate = items.some((it) => it.approximate);
  return {
    region,
    items,
    // A full DB miss (`source: 'estimate'`) is a fabricated placeholder — the
    // item card shows NO numbers for it, so it must not leak into the dish total
    // either. It starts counting only once the user fills real macros (which
    // flips the source to 'manual'). THE HONESTY RULE, applied to the total.
    totals: sumNutrients(items.filter((it) => it.per100.source !== 'estimate')),
    portion_state: approximate ? 'estimated' : 'confirmed',
    approximate,
    flags: {
      has_estimate: items.some((it) => it.per100.source === 'estimate'),
      has_ai_estimate: items.some((it) => it.per100.source === 'ai_estimate'),
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
    // User-typed numbers are no DB row — a stale matched-row name (and the
    // dry-basis / estimated-micros hints tied to that row) would misattribute them.
    return {
      ...it,
      per100,
      matched_name: undefined,
      dry_basis: undefined,
      micros_estimated: undefined,
      scaled: scaleToGrams(per100, it.grams),
    };
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

/// Remove one item from the draft entirely — the user changed their mind about a
/// dish they'd already logged ("передумал его есть, а уже отметил"). Recomputes
/// totals/flags off the survivors; a no-op for an out-of-range index.
export function removeDraftItem(draft: MealDraft, index: number): MealDraft {
  if (index < 0 || index >= draft.items.length) return draft;
  return recomputeDraft(
    draft.region,
    draft.items.filter((_, i) => i !== index),
  );
}

/// Swap one item to a different DB match the user picked from its `alternatives`
/// ("не то?"). The chosen candidate becomes the live per-100g; the previously
/// shown match drops back into the alternatives list (so the swap is reversible),
/// and the user's explicit choice clears the low-confidence state. Switching the
/// underlying food resets the cook-method baseline. Recomputes the total.
export function withItemAlternative(draft: MealDraft, index: number, altIndex: number): MealDraft {
  const it = draft.items[index];
  const chosen = it?.alternatives?.[altIndex];
  if (!it || !chosen) return draft;
  const remaining = (it.alternatives ?? []).filter((_, j) => j !== altIndex);
  return withItemReplacement(draft, index, chosen, remaining);
}

/// Replace one item's match with an explicit candidate the user found via the
/// manual DB search ("найти вручную") — same swap semantics as picking an
/// alternative: the chosen per-100g goes live and the user's choice clears the
/// low-confidence state. The previously shown match drops back into the
/// alternatives so the swap stays reversible.
export function withItemReplacement(
  draft: MealDraft,
  index: number,
  replacement: NutritionAlternative,
  keepAlternatives: NutritionAlternative[] = [],
): MealDraft {
  const items = draft.items.map((it, i) => {
    if (i !== index) return it;
    // The swapped-out row goes back under its OWN name (the DB row's, when we
    // know it) — labeling it with the component name would misattribute the
    // numbers the user is comparing against.
    const previous: NutritionAlternative = {
      name: it.matched_name ?? (it.name_ru || it.name_en),
      per100: it.per100,
    };
    return {
      ...it,
      per100: replacement.per100,
      matched_name: replacement.name, // transparency: the new row's own name
      confidence: 1, // the user confirmed the match by hand
      userChosen: true, // → "remember my choice" on save
      // The old row's hints don't describe the new pick; the user is now in
      // control of the match, so drop them rather than mislabel the swap.
      dry_basis: undefined,
      micros_estimated: undefined,
      alternatives: [previous, ...keepAlternatives],
      scaled: scaleToGrams(replacement.per100, it.grams),
    };
  });
  return recomputeDraft(draft.region, items);
}
