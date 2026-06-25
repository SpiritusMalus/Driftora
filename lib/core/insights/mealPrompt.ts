/**
 * Time-of-day aware blank-state for the food input (A3). A gently contextual
 * placeholder lowers blank-page friction (Fogg: Ability × Prompt) without ever
 * nagging — it never implies the user is late or skipped a meal, it just asks a
 * warmer question for the current part of the day. Pure: maps an hour to an
 * i18n key suffix under `food.prompt.*`; the UI localizes it.
 */

export type MealPromptKey = 'morning' | 'midday' | 'evening' | 'lateNight';

/// Maps a local hour (0–23) to a meal-prompt key. Windows are intentionally
/// soft and overlapping-free: morning 5–10, midday 11–15, evening 16–21, and
/// late night (22–4) for anything else. Friendly, never a judgement on timing.
export function mealPromptKeyForHour(hour: number): MealPromptKey {
  const h = ((Math.trunc(hour) % 24) + 24) % 24; // normalize any input into 0–23
  if (h >= 5 && h <= 10) return 'morning';
  if (h >= 11 && h <= 15) return 'midday';
  if (h >= 16 && h <= 21) return 'evening';
  return 'lateNight';
}
