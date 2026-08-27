import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { deriveQuickMeals, orderByMeal, quickMeals, type QuickMeal } from '@/lib/core/db/food';
import { itemFromQuickMeal } from '@/lib/core/services/mealDraft';
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
      totalG: null, // plain source entries carry no portion grams
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

// ---- Кесадилья-баг, второй заход (2026-08-26): «575 ккал · за 100 г» --------
//
// Pre-#208 quick-pick saves left journal rows claiming qtyG=100 for a meal the
// user weighed at 300 г, with the WHOLE portion's КБЖУ copied verbatim. The
// latest occurrence then poisons the re-log card. The heal: identical macros =
// the same physical portion, so real grams from any sibling occurrence replace
// the 100/gramless claim.
describe('deriveQuickMeals grams healing', () => {
  const meal = (day: number, totalG: number | null, kcal = 575) => ({
    rawText: 'Кесадилья',
    ts: new Date(2026, 5, day, 12),
    kcal,
    proteinG: 24,
    fatG: 30,
    carbG: 51,
    totalG,
  });

  it('heals a poisoned 100-г latest occurrence from an older identical-macro real weight', () => {
    const { recents } = deriveQuickMeals([meal(10, 300), meal(12, 100)]);
    expect(recents[0].totalG).toBe(300);
    // …and the re-log card then derives an honest per-100g from it.
    const item = itemFromQuickMeal(recents[0]);
    expect(item.grams).toBe(300);
    expect(item.per100.kcal).toBe(Math.round((575 * 100) / 300));
  });

  it('heals a gramless latest occurrence the same way', () => {
    const { recents } = deriveQuickMeals([meal(10, 300), meal(12, null)]);
    expect(recents[0].totalG).toBe(300);
  });

  it('is order-independent and takes the most recent real weight', () => {
    const rows = [meal(8, 250), meal(10, 300), meal(12, 100)];
    for (const perm of [rows, [...rows].reverse(), [rows[1], rows[2], rows[0]]]) {
      expect(deriveQuickMeals(perm).recents[0].totalG).toBe(300);
    }
  });

  it('leaves different-macro occurrences alone — a real 100-г portion stays 100 г', () => {
    // A genuine later 100-г helping has ~a third of the kcal, not an identical
    // copy; no signature match → no heal.
    const { recents } = deriveQuickMeals([meal(10, 300), meal(12, 100, 192)]);
    expect(recents[0].totalG).toBe(100);
  });

  it('never heals kcal=0 foods — identical zero macros carry no portion identity', () => {
    const water = (day: number, totalG: number | null) => ({
      rawText: 'Вода',
      ts: new Date(2026, 5, day, 12),
      kcal: 0,
      proteinG: 0,
      fatG: 0,
      carbG: 0,
      totalG,
    });
    const { recents } = deriveQuickMeals([water(10, 300), water(12, 100)]);
    expect(recents[0].totalG).toBe(100);
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
    totalG: null,
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

// ---- Кесадилья-баг (2026-08-21): порция «за 100 г» при реальных 300 г ------

describe('quickMeals portion grams (db)', () => {
  it('carries totalG when every item has a weight, null when any is missing', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    const db = drizzle(sqlite, { schema });
    await applySchema((s) => sqlite.exec(s));

    const entry = async (rawText: string, day: number, items: (number | null)[]) => {
      const [row] = await db
        .insert(schema.foodEntries)
        .values({ ts: new Date(2026, 5, day, 12), rawText, source: 'text', kcal: 900, proteinG: 40, fatG: 45, carbG: 80, confirmed: true })
        .returning({ id: schema.foodEntries.id });
      for (const qtyG of items) {
        await db.insert(schema.foodItems).values({ entryId: row.id, name: rawText, qtyG, kcal: 300 });
      }
    };

    await entry('Кесадилья', 10, [180, 120]); // full weights → 300 г
    await entry('Суп на глаз', 11, [250, null]); // one weightless item → null
    await entry('Одним числом', 12, []); // gramless single-figure entry → null

    const { recents } = await quickMeals(db);
    const byName = new Map(recents.map((m) => [m.rawText, m.totalG]));
    expect(byName.get('Кесадилья')).toBe(300);
    expect(byName.get('Суп на глаз')).toBeNull();
    expect(byName.get('Одним числом')).toBeNull();
    sqlite.close();
  });
});

describe('itemFromQuickMeal', () => {
  const meal = { rawText: 'Кесадилья', kcal: 900, proteinG: 40, fatG: 45, carbG: 80 };

  it('with known portion grams: item = real grams, per-100g derived, totals verbatim', () => {
    const it300 = itemFromQuickMeal({ ...meal, totalG: 300 });
    expect(it300.grams).toBe(300);
    expect(it300.grams_source).toBe('confirmed');
    // «на 100 г» is now an honest baseline, not the whole meal.
    expect(it300.per100.kcal).toBe(300);
    expect(it300.per100.prot).toBeCloseTo(13.3, 1);
    // The eaten figures stay the STORED totals — no re-derivation drift.
    expect(it300.scaled.kcal).toBe(900);
    expect(it300.scaled.prot).toBe(40);
  });

  it('gramless legacy entry keeps the 100-g frame with totals at scale 1', () => {
    const legacy = itemFromQuickMeal({ ...meal, totalG: null });
    expect(legacy.grams).toBe(100);
    expect(legacy.per100.kcal).toBe(900);
    expect(legacy.scaled.kcal).toBe(900);
  });
});
