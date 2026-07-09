import { desc, inArray, like } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { choiceKey, lookupNameForItem, normalizeChoiceName } from '../services/foodChoice';
import type { MealDraft, NutritionAlternative, Per100, Region } from '../services/foodParser';
import { foodChoices } from './schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// Persist the user's per-food correction (disambiguation layer 2). Upsert by
/// key so the latest choice for a food wins; `per100` is stored as JSON text.
export async function rememberFoodChoice(
  db: AnyDb,
  region: Region,
  foodName: string,
  choice: NutritionAlternative,
): Promise<void> {
  const key = choiceKey(region, foodName);
  const per100 = JSON.stringify(choice.per100);
  const ts = new Date();
  await db
    .insert(foodChoices)
    .values({ key, name: choice.name, per100, ts })
    .onConflictDoUpdate({ target: foodChoices.key, set: { name: choice.name, per100, ts } });
}

/// One remembered food, ready to re-log: its display name + exact per-100g.
export interface RememberedFood {
  name: string;
  per100: Per100;
}

/// The user's «рацион» — the foods they've confirmed before, for the current
/// region, most-recently-used first. Powers the quick "pick what I already eat +
/// type grams" flow. Deduped by normalized NAME (a food re-picked under a slightly
/// different key must not appear twice) and capped at [limit]. Rows with corrupt
/// JSON are skipped defensively. Region is matched on the `${region}::` key prefix.
export async function listFoodChoices(
  db: AnyDb,
  region: Region,
  limit = 24,
): Promise<RememberedFood[]> {
  const rows = (await db
    .select()
    .from(foodChoices)
    .where(like(foodChoices.key, `${region}::%`))
    .orderBy(desc(foodChoices.ts))) as { name: string; per100: string }[];
  const out: RememberedFood[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const norm = normalizeChoiceName(row.name);
    if (seen.has(norm)) continue;
    try {
      const per100 = JSON.parse(row.per100) as Per100;
      seen.add(norm);
      out.push({ name: row.name, per100 });
    } catch {
      // corrupt row — ignore
    }
    if (out.length >= limit) break;
  }
  return out;
}

/// Load remembered choices for the foods in a draft, keyed by [choiceKey] so the
/// pure `applyRememberedChoices` can match them. Rows with unparseable JSON are
/// skipped (defensive — a corrupt row must never break the log flow).
export async function loadRememberedChoices(
  db: AnyDb,
  region: Region,
  draft: MealDraft,
): Promise<Map<string, NutritionAlternative>> {
  const keys = draft.items.map((it) => choiceKey(region, lookupNameForItem(it, region)));
  const out = new Map<string, NutritionAlternative>();
  if (keys.length === 0) return out;

  const rows = (await db.select().from(foodChoices).where(inArray(foodChoices.key, keys))) as {
    key: string;
    name: string;
    per100: string;
  }[];
  for (const row of rows) {
    try {
      const per100 = JSON.parse(row.per100) as Per100;
      out.set(row.key, { name: row.name, per100 });
    } catch {
      // corrupt row — ignore
    }
  }
  return out;
}
