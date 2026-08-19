import { displayItemName, normalizeChoiceName } from './foodChoice';
import type { MealDraft, NutritionAlternative, NutritionItem, Region } from './foodParser';

/**
 * WHAT MAY GO INTO THE SHARED BASE — the one place that answers it, pure and
 * testable, so the rule is readable instead of buried in a screen.
 *
 * The shared base exists for the foods the tables do not have: шаурма из ларька,
 * хачапури, бабушкины сырники. It is filled by the person who already did the
 * work of typing the numbers — and by nobody else, which is what the rules below
 * come down to.
 *
 * ONLY the user's OWN confirmed numbers travel:
 *   • `manual` — they typed the per-100g themselves. This is the whole point.
 *   • `label`  — read off the product's own panel in a photo (ground truth).
 *
 * Everything else stays home, each for its own reason:
 *   • `ai_estimate` — a guess. The app's standing rule is that a guess never
 *     becomes «моя правда» until the user touches it; letting it become
 *     EVERYONE's truth is the same mistake, multiplied by the number of people
 *     who then find it.
 *   • `estimate` — a database miss carries no numbers at all.
 *   • `usda` / `skurikhin` / `openfoodfacts` / `fatsecret` / `apininjas` — a
 *     measured table already has this food, and a crowd copy of it would only
 *     compete with the original for foods the original serves better.
 *   • `community` — a row must never vote for itself: re-donating what the base
 *     just told you would let one entry inflate its own confirmation count on
 *     every meal it is logged into.
 *   • `history` — re-logged from an earlier entry whose real origin is no longer
 *     visible here; whatever it was, it was shareable (or not) back then.
 *
 * The user's meal text, weights, times and the entry itself never appear: this
 * returns FOODS, not meals.
 */

/** Longest name the shared base accepts — mirrors the server's own cap. */
const MAX_NAME_LEN = 60;

/** A name longer than this is a note about a meal, not the name of a dish. */
const MAX_NAME_WORDS = 4;

/** Sources that ARE the user's own confirmed numbers. */
const OWN_NUMBERS = ['manual', 'label'] as const;

function isOwnNumbers(item: NutritionItem): boolean {
  return (OWN_NUMBERS as readonly string[]).includes(item.per100.source);
}

/**
 * A name we are willing to publish under. Deliberately STRICTER than the
 * server's floor, because the server can only see a string while we can see it
 * is about to be attached to a real person's habit: a short dish name («плов»,
 * «шаурма с курицей») passes, and a sentence someone typed to describe their
 * evening — the shape a private detail actually arrives in — does not.
 */
function isPublishableName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LEN) return false;
  const normalized = normalizeChoiceName(trimmed);
  if (normalized.length === 0) return false;
  if (normalized.split(' ').length > MAX_NAME_WORDS) return false;
  // At least two letters: «250», «2 шт» and «100 г» are quantities, not dishes.
  return [...normalized].filter((c) => /\p{L}/u.test(c)).length >= 2;
}

/**
 * The foods from a just-saved meal that may be offered to the shared base —
 * usually none, sometimes one. Deduped by name within the meal, so a plate with
 * the same dish twice donates one confirmation and not two.
 *
 * Returning a list (rather than doing the sending) keeps the decision testable
 * and leaves the caller to honor the setting and the consent — this function
 * never assumes it is allowed to send anything.
 */
export function contributableFoods(draft: MealDraft, region: Region): NutritionAlternative[] {
  const out: NutritionAlternative[] = [];
  const seen = new Set<string>();
  for (const item of draft.items) {
    if (!isOwnNumbers(item)) continue;
    const name = displayItemName(item, region).trim();
    if (!isPublishableName(name)) continue;
    const key = normalizeChoiceName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, per100: item.per100 });
  }
  return out;
}
