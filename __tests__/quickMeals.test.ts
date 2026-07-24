import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { deriveQuickMeals, orderByMeal, quickMeals, type QuickMeal } from '@/lib/core/db/food';
import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import type { MealType } from '@/lib/core/insights/mealType';

const e = (rawText: string, day: number, kcal: number, proteinG: number) => ({
  rawText,
  ts: new Date(2026, 5, day, 12),
  kcal,
  proteinG,
  fatG: 0,
  carbG: 0,
});

describe('deriveQuickMeals', () => {
  it('groups case/space-insensitively, keeps latest macros, and ranks each list', () => {
    // Deliberately unsorted; "ОВСЯНКА" must merge into "Овсянка".
    const entries = [
      e('Банан', 13, 90, 1),
      e('Овсянка', 12, 310, 22),
      e('Кофе', 11, 10, 0),
      e('ОВСЯНКА', 9, 300, 20),
      e('Овсянка', 15, 320, 25), // latest for the oat group
      e('Кофе', 14, 12, 1),
      e('Овсянка', 10, 305, 21),
    ];

    const { recents, favorites } = deriveQuickMeals(entries);

    // recents: distinct, newest-first by latest occurrence.
    expect(recents.map((m) => m.rawText)).toEqual(['Овсянка', 'Кофе', 'Банан']);
    expect(recents[0]).toEqual({
      rawText: 'Овсянка',
      kcal: 320,
      proteinG: 25,
      fatG: 0,
      carbG: 0,
      count: 4,
      meal: 'lunch', // hour 12, no keyword/chip → clock says обед
    });

    // favorites: only repeats (count ≥ 2), most-repeated first.
    expect(favorites.map((m) => m.rawText)).toEqual(['Овсянка', 'Кофе']);
    expect(favorites.map((m) => m.count)).toEqual([4, 2]);
  });

  it('respects the list limits', () => {
    const entries = [e('a', 1, 1, 1), e('b', 2, 1, 1), e('c', 3, 1, 1)];
    expect(deriveQuickMeals(entries, { recentLimit: 2 }).recents).toHaveLength(2);
  });
});

describe('quick meal-of-day tagging', () => {
  const m = (rawText: string, day: number, meal?: MealType) => ({
    rawText,
    ts: new Date(2026, 5, day, 12), // hour 12 → clock says lunch unless overridden
    kcal: 1,
    proteinG: 1,
    fatG: 0,
    carbG: 0,
    meal,
  });

  it('tags the dominant meal-of-day; a stored chip beats the clock, most-frequent wins', () => {
    const entries = [
      m('Овсянка', 10, 'breakfast'),
      m('Овсянка', 11, 'breakfast'),
      m('Овсянка', 12, 'lunch'), // latest occurrence, but breakfast is more frequent
    ];
    expect(deriveQuickMeals(entries).recents[0].meal).toBe('breakfast');
  });

  it('breaks a frequency tie toward the latest occurrence', () => {
    const entries = [m('Кофе', 10, 'breakfast'), m('Кофе', 12, 'dinner')]; // 1–1 tie
    expect(deriveQuickMeals(entries).recents[0].meal).toBe('dinner');
  });

  it('falls back to the typed keyword when no chip is stored', () => {
    // 'ужин: …' names dinner even though the clock (hour 12) would say lunch.
    expect(deriveQuickMeals([m('Ужин: гречка', 10)]).recents[0].meal).toBe('dinner');
  });
});

describe('orderByMeal', () => {
  const qm = (rawText: string, meal: MealType): QuickMeal => ({
    rawText,
    kcal: 1,
    proteinG: 1,
    fatG: 0,
    carbG: 0,
    count: 1,
    meal,
  });

  it('leads with the current meal-of-day, preserving order within each partition', () => {
    const list = [qm('обед-суп', 'lunch'), qm('завтрак-каша', 'breakfast'), qm('обед-плов', 'lunch'), qm('завтрак-яйца', 'breakfast')];
    expect(orderByMeal(list, 'breakfast').map((x) => x.rawText)).toEqual([
      'завтрак-каша',
      'завтрак-яйца',
      'обед-суп',
      'обед-плов',
    ]);
  });

  it('is a no-op shape-wise when nothing matches (drops nothing)', () => {
    const list = [qm('a', 'lunch'), qm('b', 'dinner')];
    expect(orderByMeal(list, 'breakfast').map((x) => x.rawText)).toEqual(['a', 'b']);
  });
});

describe('quickMeals (db)', () => {
  it('reads only confirmed entries', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    const db = drizzle(sqlite, { schema });
    await applySchema((s) => sqlite.exec(s));

    const insert = (rawText: string, day: number, confirmed: boolean) =>
      db.insert(schema.foodEntries).values({
        ts: new Date(2026, 5, day, 12),
        rawText,
        source: 'text',
        kcal: 200,
        proteinG: 15,
        fatG: 5,
        carbG: 10,
        confirmed,
      });

    await insert('Овсянка', 10, true);
    await insert('Овсянка', 12, true);
    await insert('Кофе', 11, true);
    await insert('Черновик', 13, false); // unconfirmed → excluded

    const { recents, favorites } = await quickMeals(db);
    expect(recents.map((m) => m.rawText).sort()).toEqual(['Кофе', 'Овсянка']);
    expect(favorites.map((m) => m.rawText)).toEqual(['Овсянка']);
    sqlite.close();
  });
});
