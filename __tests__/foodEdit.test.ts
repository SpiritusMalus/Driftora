import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

import { applySchema } from '@/lib/core/db/init';
import {
  deleteFoodEntry,
  draftFromStoredEntry,
  getFoodEntry,
  listEntriesForDay,
  saveParsedEntry,
  todayMacroTotals,
  updateFoodEntry,
} from '@/lib/core/db/food';
import * as schema from '@/lib/core/db/schema';
import { withItemGrams } from '@/lib/core/services/mealDraft';
import type { MealDraft } from '@/lib/core/services/foodParser';

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

function draft(): MealDraft {
  const items = [
    {
      name_ru: 'курица',
      name_en: 'chicken',
      grams: 100,
      grams_source: 'confirmed' as const,
      confidence: 0.9,
      per100: { kcal: 200, prot: 20, fat: 10, carb: 0, minerals: {}, source: 'usda' as const },
      scaled: { kcal: 200, prot: 20, fat: 10, carb: 0, minerals: {} },
      approximate: false,
    },
    {
      name_ru: 'рис',
      name_en: 'rice',
      grams: 150,
      grams_source: 'confirmed' as const,
      confidence: 0.9,
      per100: { kcal: 130, prot: 2.7, fat: 0.3, carb: 28, minerals: {}, source: 'usda' as const },
      scaled: { kcal: 195, prot: 4.1, fat: 0.5, carb: 42, minerals: {} },
      approximate: false,
    },
  ];
  return {
    region: 'RU',
    items,
    totals: { kcal: 395, prot: 24.1, fat: 10.5, carb: 42, minerals: {} },
    portion_state: 'confirmed',
    approximate: false,
    flags: { has_estimate: false, low_confidence: false },
  };
}

async function setup() {
  const { sqlite, db } = makeDb();
  await applySchema((stmt) => sqlite.exec(stmt));
  const id = await saveParsedEntry(db, { rawText: 'курица с рисом', source: 'text', draft: draft() });
  return { sqlite, db, id };
}

describe('food entry edit/delete', () => {
  it('getFoodEntry returns the entry and its items', async () => {
    const { sqlite, db, id } = await setup();
    const detail = await getFoodEntry(db, id);
    expect(detail).not.toBeNull();
    expect(detail!.entry.rawText).toBe('курица с рисом');
    expect(detail!.items).toHaveLength(2);
    sqlite.close();
  });

  it('draftFromStoredEntry rebuilds editable items whose grams edits rescale', async () => {
    const { sqlite, db, id } = await setup();
    const detail = await getFoodEntry(db, id);
    const d = draftFromStoredEntry('RU', detail!.items);
    // Initial scaled totals match what was stored (lossless on load).
    expect(d.totals.kcal).toBe(395);
    // Doubling the chicken's grams doubles its scaled kcal (derived per100 works).
    const edited = withItemGrams(d, 0, 200);
    expect(edited.items[0].scaled.kcal).toBe(400);
    expect(edited.totals.kcal).toBe(595);
    sqlite.close();
  });

  it('updateFoodEntry replaces items + totals with no leftover rows', async () => {
    const { sqlite, db, id } = await setup();
    const detail = await getFoodEntry(db, id);
    const d = draftFromStoredEntry('RU', detail!.items);
    const edited = withItemGrams(d, 0, 200); // chicken 100 → 200g

    await updateFoodEntry(db, id, { rawText: 'курица с рисом (больше)', source: 'text', draft: edited });

    const after = await getFoodEntry(db, id);
    expect(after!.entry.rawText).toBe('курица с рисом (больше)');
    expect(after!.entry.kcal).toBe(595);
    // No leftover/duplicated rows — exactly the two edited items.
    expect(after!.items).toHaveLength(2);
    const allItems = await db.select().from(schema.foodItems);
    expect(allItems).toHaveLength(2);
    // Day totals reflect the edit.
    const totals = await todayMacroTotals(db);
    expect(totals.kcal).toBe(595);
    sqlite.close();
  });

  it('updateFoodEntry preserves the original ts when none is given', async () => {
    const { sqlite, db, id } = await setup();
    const before = (await getFoodEntry(db, id))!.entry.ts.getTime();
    const detail = await getFoodEntry(db, id);
    await updateFoodEntry(db, id, {
      rawText: 'x',
      source: 'text',
      draft: draftFromStoredEntry('RU', detail!.items),
    });
    const after = (await getFoodEntry(db, id))!.entry.ts.getTime();
    expect(after).toBe(before);
    sqlite.close();
  });

  it('deleteFoodEntry removes the entry and all its items (no orphans)', async () => {
    const { sqlite, db, id } = await setup();
    await deleteFoodEntry(db, id);
    expect(await getFoodEntry(db, id)).toBeNull();
    expect(await listEntriesForDay(db)).toHaveLength(0);
    const orphans = await db.select().from(schema.foodItems).where(eq(schema.foodItems.entryId, id));
    expect(orphans).toHaveLength(0);
    const totals = await todayMacroTotals(db);
    expect(totals.kcal).toBe(0);
    sqlite.close();
  });
});
