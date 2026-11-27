import type { MealDraft, NutritionAlternative, NutritionItem, Region } from './foodParser';
import { recomputeDraft, scaleToGrams } from './mealDraft';

export interface RememberedChoice extends NutritionAlternative {
  explicit?: true;
  rememberedAt?: number;
}

/// Remembering the user's per-food correction (disambiguation layer 2). Pure
/// helpers: keying a food name, and re-applying a remembered per-100g to a fresh
/// draft so a correction the user made once sticks on the next log of that food.
/// The persistence lives in `lib/core/db/foodChoices.ts`; this stays testable.

/// Normalize a food name for a stable key: lowercase, ё→е, collapse whitespace.
export function normalizeChoiceName(name: string): string {
  return name.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/// Exact names first, preserving the provider order within either group.
export function prioritizeExactFoodNames(
  query: string,
  candidates: readonly NutritionAlternative[],
): NutritionAlternative[] {
  const normalize = (name: string) => normalizeChoiceName(name.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' '));
  const match = normalize(query);
  if (!match) return [...candidates];
  const exact: NutritionAlternative[] = [];
  const other: NutritionAlternative[] = [];
  for (const candidate of candidates) {
    (normalize(candidate.name) === match ? exact : other).push(candidate);
  }
  return [...exact, ...other];
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

/// The first key is the usual region-specific name. Older stored diary items
/// only have the displayed label, so explicit choices under either language
/// can still be recovered when the other name was used for recognition.
export function itemChoiceKeys(item: NutritionItem, region: Region): string[] {
  const original = item.originalLookupName ?? lookupNameForItem(item, region);
  return [...new Set([original, item.name_ru, item.name_en]
    .filter((name) => name.trim().length > 0)
    .map((name) => choiceKey(region, name)))];
}

/// The name to DISPLAY / PERSIST for an item. Once the user has explicitly picked
/// a match ("не то?" / "найти вручную" → `userChosen`), the entry is named by the
/// real DB row they chose (`matched_name`), NOT their raw typed label — «скир»
/// becomes «Скир натуральный». Otherwise we keep the user's own words (the card
/// separately shows the matched row in parentheses for transparency). NOTE: this
/// is display-only — the memory KEY still uses [lookupNameForItem] (the raw name),
/// so a correction stays keyed to what the user actually types next time.
export function displayItemName(
  item: Pick<NutritionItem, 'name_ru' | 'name_en' | 'matched_name' | 'userChosen'>,
  region: Region,
  locale?: 'ru' | 'en',
): string {
  if (item.userChosen && item.matched_name && item.matched_name.trim().length > 0) {
    return item.matched_name.trim();
  }
  return lookupNameForItem(item, locale ? (locale === 'en' ? 'US' : 'RU') : region);
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
  choices: ReadonlyMap<string, RememberedChoice>,
  mode: 'all' | 'explicit' = 'all',
): MealDraft {
  if (choices.size === 0) return draft;
  let changed = false;
  const items = draft.items.map((it) => {
    // «По упаковке» — точные числа, только что прочитанные с ЭТОЙ пачки. Память
    // хранит прошлый выбор ПО ИМЕНИ еды — заменять ей свежую этикетку значит
    // предпочесть старую догадку напечатанному факту (и другой продукт под тем
    // же словом: «творог» в памяти ≠ творог в руках). Штрихкод-путь память не
    // применяет по той же причине.
    if (it.per100.source === 'label') return it;
    const matches = itemChoiceKeys(it, region).map((key) => choices.get(key));
    const explicit = matches
      .filter((choice): choice is RememberedChoice =>
        !!choice && (choice.explicit === true || choice.per100.source === 'manual'))
      .sort((a, b) => (b.rememberedAt ?? 0) - (a.rememberedAt ?? 0))[0];
    // Photo references take priority over remembered automatic database hits.
    const remembered = explicit ?? (mode === 'all' ? matches[0] : undefined);
    if (!remembered) return it;
    changed = true;
    return {
      ...it,
      per100: remembered.per100,
      matched_name: remembered.name, // transparency: whose numbers these are
      confidence: 1, // the user chose this match before — honor it confidently
      ...(explicit ? { userChosen: true, choiceFromMemory: true } : {}),
      // The old row's hints don't describe the remembered pick — the same
      // contract as withItemReplacement. Left in place, a dry_basis banner
      // would push the «впишите вес сухой части» fix against per-100g numbers
      // that are already the cooked ones the user chose.
      dry_basis: undefined,
      dry_weight: undefined,
      basis_adjusted: undefined,
      micros_estimated: undefined,
      scaled: scaleToGrams(remembered.per100, it.grams),
    };
  });
  return changed ? recomputeDraft(draft.region, items) : draft;
}
