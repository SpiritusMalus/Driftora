import { displayItemName } from '../services/foodChoice';
import type { NutritionItem, Region } from '../services/foodParser';

/**
 * The name a saved meal carries in the diary, built FROM ITS DISHES.
 *
 * Tester feedback 2026-08-12: «тайтл еды пусть будет структурно, а не обрезанные
 * символы». The entry used to be named by the raw sentence the user typed or
 * dictated — «я на завтрак съел борщ с хлебом и ещё выпил кофе» — which the list
 * renders on one line, so it arrived as «я на завтрак съел борщ с хле…». The cut
 * lands mid-word and the useful part (WHAT was eaten) is exactly what falls off
 * the end.
 *
 * Naming by the dishes fixes both halves: the words that matter come first, and
 * the string is short enough that it usually doesn't need cutting at all. It also
 * makes the name a FUNCTION of the draft, so it can follow edits (same feedback,
 * item 1: «поменял — тайтл тоже должен меняться») instead of freezing whatever
 * was said before the corrections.
 */

/** Beyond this a one-line row stops being scannable and starts being a paragraph. */
const MAX_SHOWN_NAMES = 3;

/** Uppercase the first character only — never touch the rest ("кофе с молоком"). */
function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/**
 * Structured title for a set of dishes, e.g. «Борщ, хлеб, сметана».
 *
 * COMPLETE ON PURPOSE — no «+2» here. This string is what the log screen puts in
 * the text field and what gets saved as the entry's name, and the field is also
 * the input the user edits to add a forgotten dish and parse again. A title that
 * silently dropped the tail would turn that re-parse into data loss: the hidden
 * dishes are not in the text, so they would not come back. Shortening is a
 * DISPLAY concern — see [shortMealTitle].
 *
 * Duplicates collapse: a plate parsed as two separate «хлеб» rows is still one
 * word in the name. Returns '' for no items, so callers can decide what an
 * unnamed entry should fall back to rather than being handed a fake title.
 */
export function mealTitle(
  items: readonly Pick<NutritionItem, 'name_ru' | 'name_en' | 'matched_name' | 'userChosen'>[],
  region: Region,
): string {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of items) {
    const name = displayItemName(item, region).trim();
    if (name.length === 0) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  if (names.length === 0) return '';
  return capitalizeFirst(names.join(', '));
}

/**
 * Shorten a saved meal name for a ONE-LINE row.
 *
 * The row used to hand a long name straight to `numberOfLines={1}`, so the cut
 * landed wherever the pixels ran out — mid-word, and after the dish names the
 * reader actually wanted. This cuts on a dish boundary instead and says how many
 * are hidden, so «Борщ, хлеб, сметана, кофе, сахар» reads «Борщ, хлеб, сметана
 * +2» rather than «Борщ, хлеб, смет…».
 *
 * Works on the stored string rather than on items because the day list holds
 * entry rows only — pulling every entry's dishes just to draw a title would be a
 * query per row for a cosmetic gain.
 *
 * «+2» rather than «и ещё 2»: no plural forms to get wrong in either language.
 */
export function shortMealTitle(title: string, maxNames = MAX_SHOWN_NAMES): string {
  const names = title
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // Not a dish list (a free-typed sentence, or one long name) — leave it be and
  // let the row ellipsize. Inventing a break inside prose would read as garbage.
  if (names.length <= maxNames) return title.trim();

  const hidden = names.length - maxNames;
  return `${names.slice(0, maxNames).join(', ')} +${hidden}`;
}
