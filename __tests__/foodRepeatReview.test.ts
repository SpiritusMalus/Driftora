import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import {
  applyDraftToPendingEntry,
  confirmFoodEntry,
  getFoodEntry,
  quickMeals,
  repeatFoodEntry,
  savePendingEntry,
} from '@/lib/core/db/food';
import * as schema from '@/lib/core/db/schema';
import type { MealDraft } from '@/lib/core/services/foodParser';

/**
 * «Повторить» must not launder an unreviewed parse into a reviewed one.
 *
 * The ↻ button sits on EVERY day row, including a background parse the user has
 * never opened — that row wears «≈ проверьте» precisely because nobody checked
 * the numbers. The copy has to keep asking; otherwise the same AI estimate reads
 * as confirmed and joins the quick-add ribbon (which filters on `confirmed`).
 */

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

function draft(): MealDraft {
  const items = [
    {
      name_ru: 'сырники',
      name_en: 'syrniki',
      grams: 200,
      grams_source: 'confirmed' as const,
      confidence: 0.6,
      per100: { kcal: 220, prot: 12, fat: 9, carb: 22, minerals: {}, source: 'ai_estimate' as const },
      scaled: { kcal: 440, prot: 24, fat: 18, carb: 44, minerals: {} },
      approximate: false,
    },
  ];
  return {
    region: 'RU',
    items,
    totals: { kcal: 440, prot: 24, fat: 18, carb: 44, minerals: {} },
    portion_state: 'confirmed',
    approximate: false,
    flags: { has_estimate: false, has_ai_estimate: true, low_confidence: false },
  };
}

/// A photo whose parse landed while the user was elsewhere: the row exists and
/// carries numbers, but has never been opened — exactly the «≈ проверьте» state.
async function adoptedButUnreviewed(db: ReturnType<typeof makeDb>['db']): Promise<number> {
  const id = await savePendingEntry(db, { source: 'photo' });
  await applyDraftToPendingEntry(db, id, { rawText: 'сырники', draft: draft() });
  return id;
}

describe('repeatFoodEntry carries the review state', () => {
  it('a repeat of an UNREVIEWED entry stays unreviewed', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));
    const id = await adoptedButUnreviewed(db);
    expect((await getFoodEntry(db, id))!.entry.confirmed).toBe(false);

    const copyId = await repeatFoodEntry(db, id);
    const copy = (await getFoodEntry(db, copyId!))!.entry;

    // Without the fix this is `true`: the pill vanishes off numbers nobody checked.
    expect(copy.confirmed).toBe(false);
    // The numbers themselves must still come across untouched.
    expect(copy.kcal).toBe(440);
    expect(copy.proteinG).toBe(24);
    sqlite.close();
  });

  it('an unreviewed repeat stays out of the quick-add ribbon', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));
    const id = await adoptedButUnreviewed(db);
    await repeatFoodEntry(db, id);

    // Both rows are unreviewed → nothing to offer as a one-tap quick meal.
    const { recents, favorites } = await quickMeals(db);
    expect(recents).toEqual([]);
    expect(favorites).toEqual([]);
    sqlite.close();
  });

  it('a repeat of a REVIEWED entry stays reviewed (feature intact)', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));
    const id = await adoptedButUnreviewed(db);
    // Opening the row is the review.
    await confirmFoodEntry(db, id);

    const copyId = await repeatFoodEntry(db, id);
    expect((await getFoodEntry(db, copyId!))!.entry.confirmed).toBe(true);

    const { recents } = await quickMeals(db);
    expect(recents.map((m) => m.rawText)).toEqual(['сырники']);
    sqlite.close();
  });
});
