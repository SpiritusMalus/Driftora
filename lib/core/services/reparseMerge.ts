import { lookupNameForItem, normalizeChoiceName } from './foodChoice';
import type { MealDraft, NutritionItem, Region } from './foodParser';
import { recomputeDraft, scaleToGrams } from './mealDraft';

/**
 * Re-parsing an EDITED meal text without throwing away the work already done on
 * it.
 *
 * Tester feedback 2026-08-12: «если я перечислил еду и забыл указать кофе — то
 * возможность дополнить, и чтобы искало возможно изменённый текст». The natural
 * move is to add the missing dish to the text and parse again — but a plain
 * re-parse also resets every weight the user had just typed and every «не то?»
 * correction they had just made, which is worse than not offering it at all.
 *
 * So the fresh parse decides WHICH dishes are in the meal (that is the whole
 * point of re-reading the text), and the previous draft decides WHAT IS KNOWN
 * about the ones that survived:
 *
 * - a weight the user confirmed by hand is kept — the model's fresh guess must
 *   not overwrite a number a human typed;
 * - a match the user explicitly picked (`userChosen`) is kept whole, including
 *   its per-100g, so «скир» does not silently revert to a different row.
 *
 * Dishes dropped from the text disappear, new ones arrive parsed normally. This
 * is deliberately keyed by NAME rather than position: the parse may return the
 * same dishes in a different order once a new one is mentioned mid-sentence.
 */

/** Same food, for the purpose of carrying edits across a re-parse. */
function mergeKey(item: Pick<NutritionItem, 'name_ru' | 'name_en'>, region: Region): string {
  return normalizeChoiceName(lookupNameForItem(item, region));
}

/**
 * Carry the user's edits from `previous` onto a freshly parsed `next`.
 *
 * Only the FIRST previous item under a given name is reused: if a plate had two
 * «хлеб» rows with different weights, guessing which one a single fresh row
 * inherits would be a coin flip, and a wrong weight is worse than a fresh guess
 * the user can see is a guess.
 */
export function mergeReparsedItems(
  previous: readonly NutritionItem[],
  next: readonly NutritionItem[],
  region: Region,
): NutritionItem[] {
  const byName = new Map<string, NutritionItem>();
  for (const item of previous) {
    const key = mergeKey(item, region);
    if (!byName.has(key)) byName.set(key, item);
  }

  return next.map((fresh) => {
    const prior = byName.get(mergeKey(fresh, region));
    if (!prior) return fresh;

    // A match the user picked themselves survives intact — that choice was an
    // explicit act, not an estimate to be re-derived. Its per-100g is the one to
    // scale by, so only the WEIGHT can come from the fresh parse.
    if (prior.userChosen) {
      if (prior.grams_source === 'confirmed') return prior;
      return { ...prior, grams: fresh.grams, scaled: scaleToGrams(prior.per100, fresh.grams) };
    }

    // Otherwise keep only what the user actually decided — the weight — and let
    // the fresh per-100g stand. `scaled` MUST be recomputed rather than carried
    // over: the re-parse may have matched a different DB row, and pairing the
    // old scaled numbers with the new per-100g would silently invent a portion
    // that matches neither.
    if (prior.grams_source === 'confirmed') {
      return {
        ...fresh,
        grams: prior.grams,
        grams_source: 'confirmed' as const,
        scaled: scaleToGrams(fresh.per100, prior.grams),
      };
    }
    return fresh;
  });
}

/** [mergeReparsedItems] over whole drafts, with totals/flags recomputed. */
export function mergeReparsedDraft(previous: MealDraft | null, next: MealDraft, region: Region): MealDraft {
  if (!previous || previous.items.length === 0) return next;
  const merged = mergeReparsedItems(previous.items, next.items, region);
  return recomputeDraft(region, merged);
}
