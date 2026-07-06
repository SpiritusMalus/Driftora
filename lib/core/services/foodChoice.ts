import type { MealDraft, NutritionAlternative, NutritionItem, Region } from './foodParser';
import { recomputeDraft, scaleToGrams } from './mealDraft';

/// Remembering the user's per-food correction (disambiguation layer 2). Pure
/// helpers: keying a food name, and re-applying a remembered per-100g to a fresh
/// draft so a correction the user made once sticks on the next log of that food.
/// The persistence lives in `lib/core/db/foodChoices.ts`; this stays testable.

/// Normalize a food name for a stable key: lowercase, ё→е, collapse whitespace.
export function normalizeChoiceName(name: string): string {
  return name.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/// The lookup name for a food (region-aware, mirrors the server resolver): US
/// uses the English name, RU the Russian one, each falling back to the other.
export function lookupNameForItem(item: Pick<NutritionItem, 'name_ru' | 'name_en'>, region: Region): string {
  const name = region === 'US' ? item.name_en : item.name_ru;
  return (name || item.name_en || item.name_ru).trim();
}

/// The choice key: region + normalized lookup name. Same food, same key.
export function choiceKey(region: Region, name: string): string {
  return `${region}::${normalizeChoiceName(name)}`;
}

/**
 * Re-apply remembered choices to a freshly parsed draft. For each item whose
 * food the user has corrected before, swap in the remembered per-100g (exact,
 * with its own source) as a confident match and recompute. Untouched otherwise.
 * `choices` is keyed by [choiceKey].
 */
export function applyRememberedChoices(
  draft: MealDraft,
  region: Region,
  choices: Map<string, NutritionAlternative>,
): MealDraft {
  if (choices.size === 0) return draft;
  let changed = false;
  const items = draft.items.map((it) => {
    const remembered = choices.get(choiceKey(region, lookupNameForItem(it, region)));
    if (!remembered) return it;
    changed = true;
    return {
      ...it,
      per100: remembered.per100,
      matched_name: remembered.name, // transparency: whose numbers these are
      confidence: 1, // the user chose this match before — honor it confidently
      cook_method: undefined,
      basePer100: undefined,
      scaled: scaleToGrams(remembered.per100, it.grams),
    };
  });
  return changed ? recomputeDraft(draft.region, items) : draft;
}
