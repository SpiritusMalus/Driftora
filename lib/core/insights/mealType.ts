/**
 * Meal-of-day classification for the food day list. Two signals, keyword first:
 *  1) an explicit word the user typed (завтрак / обед / ужин / полдник, and the
 *     English equivalents) wins — it's their stated intent, even at an odd hour;
 *  2) otherwise the entry's clock time decides, reusing the soft windows from
 *     [mealPromptKeyForHour] so the input placeholder and the list agree.
 *
 * Pure: no DB, no i18n — the UI localizes the returned [MealType] under
 * `food.meal.*`. Drives the visual separation of приёмы пищи in the day view.
 */

import { mealPromptKeyForHour, type MealPromptKey } from './mealPrompt';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/// Display order — chronological through the day (полдник sits between обед and
/// ужин). Both the keyword scan and the grouped list honor this order.
export const MEAL_ORDER: readonly MealType[] = ['breakfast', 'lunch', 'snack', 'dinner'];

/// Keyword triggers per meal, checked in [MEAL_ORDER]. Matching is substring on
/// a normalized string, so inflections (обед → «пообедал», ужин → «ужинал») and
/// a leading «завтрак: …» label both hit. ё is folded to е before matching.
const KEYWORDS: Record<MealType, readonly string[]> = {
  breakfast: ['завтрак', 'breakfast'],
  lunch: ['обед', 'lunch'],
  snack: ['полдник', 'перекус', 'snack'],
  dinner: ['ужин', 'dinner', 'supper'],
};

const PROMPT_TO_MEAL: Record<MealPromptKey, MealType> = {
  morning: 'breakfast',
  midday: 'lunch',
  evening: 'dinner',
  lateNight: 'snack',
};

/** The meal a free-text entry names explicitly, or `null` if it names none. */
export function mealTypeFromKeyword(text: string): MealType | null {
  const t = text.toLowerCase().replace(/ё/g, 'е');
  for (const type of MEAL_ORDER) {
    if (KEYWORDS[type].some((w) => t.includes(w))) return type;
  }
  return null;
}

/** Keyword if the text names a meal, else the meal for the entry's local hour. */
export function mealTypeForEntry(rawText: string, ts: Date): MealType {
  return mealTypeFromKeyword(rawText) ?? PROMPT_TO_MEAL[mealPromptKeyForHour(ts.getHours())];
}

export interface MealGroup<E> {
  type: MealType;
  entries: E[];
}

/**
 * Buckets day entries into meal groups in [MEAL_ORDER], preserving each input's
 * order within its group (callers pass newest-first → it stays newest-first).
 * Empty meals are omitted, so the list only renders sections that have food.
 */
export function groupEntriesByMeal<E extends { rawText: string; ts: Date }>(entries: E[]): MealGroup<E>[] {
  const buckets = new Map<MealType, E[]>();
  for (const e of entries) {
    const type = mealTypeForEntry(e.rawText, e.ts);
    const arr = buckets.get(type);
    if (arr) arr.push(e);
    else buckets.set(type, [e]);
  }
  return MEAL_ORDER.filter((type) => buckets.has(type)).map((type) => ({ type, entries: buckets.get(type)! }));
}
