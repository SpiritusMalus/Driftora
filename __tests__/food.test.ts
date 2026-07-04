import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import {
  getFoodEntry,
  listEntriesForDay,
  repeatFoodEntry,
  saveParsedEntry,
  todayMacroTotals,
} from '@/lib/core/db/food';
import * as schema from '@/lib/core/db/schema';
import type { MealDraft } from '@/lib/core/services/foodParser';
import { withItemManualMacros } from '@/lib/core/services/mealDraft';
import { StubFoodParser } from '@/lib/core/services/stubFoodParser';

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

/// Offline, every stub item is a `source: 'estimate'` DB miss whose numbers the
/// UI hides — and the honest total excludes them until the user types macros.
/// This mirrors that step: fill each item so there are real numbers to save.
function fillMacros(draft: MealDraft): MealDraft {
  let d = draft;
  for (let i = 0; i < d.items.length; i++) {
    d = withItemManualMacros(d, i, { kcal: 120, prot: 10, fat: 5, carb: 8 });
  }
  return d;
}

describe('food logging (parse → save → totals)', () => {
  it('saves a parsed meal and reflects it in today totals', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    const text = 'омлет из трёх яиц и кофе с молоком';
    const parsed = await new StubFoodParser().parse(text, 'RU');
    expect(parsed.items.length).toBeGreaterThan(0);
    // Parsed offline → all DB misses → total 0 until the user fills macros.
    expect(parsed.totals.kcal).toBe(0);
    const draft = fillMacros(parsed);
    expect(draft.totals.kcal).toBeGreaterThan(0);

    await saveParsedEntry(db, { rawText: text, source: 'text', draft });

    const totals = await todayMacroTotals(db);
    expect(totals.kcal).toBeCloseTo(draft.totals.kcal, 1);
    expect(totals.proteinG).toBeGreaterThan(0);

    const entries = await listEntriesForDay(db);
    expect(entries).toHaveLength(1);
    expect(entries[0].confirmed).toBe(true);
    expect(entries[0].source).toBe('text');

    sqlite.close();
  });

  it('does not persist an unfilled DB miss (no phantom calories on reload)', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    // Two items: a banana the user fills in (manual) and an unfilled "пончик" miss.
    const parsed = await new StubFoodParser().parse('банан, пончик', 'RU');
    expect(parsed.items.length).toBe(2);
    const draft = withItemManualMacros(parsed, 0, { kcal: 89, prot: 1.1, fat: 0.3, carb: 23 });
    // Total reflects only the filled banana; the unfilled пончик is excluded.
    expect(draft.totals.kcal).toBeGreaterThan(0);

    const id = await saveParsedEntry(db, { rawText: 'банан, пончик', source: 'text', draft });

    // Only the filled item was stored — the miss left no phantom row.
    const detail = await getFoodEntry(db, id);
    expect(detail!.items).toHaveLength(1);
    expect(detail!.items[0].name).toContain('Банан');
    const totals = await todayMacroTotals(db);
    expect(totals.kcal).toBeCloseTo(draft.totals.kcal, 1);

    sqlite.close();
  });

  it('only counts entries within the requested day', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    const draft = fillMacros(await new StubFoodParser().parse('банан', 'US'));
    expect(draft.totals.kcal).toBeGreaterThan(0);
    await saveParsedEntry(db, {
      rawText: 'банан',
      source: 'text',
      draft,
      ts: new Date(2020, 0, 1, 9, 0),
    });

    const todayTotals = await todayMacroTotals(db, new Date());
    expect(todayTotals.kcal).toBe(0);

    const thatDay = await todayMacroTotals(db, new Date(2020, 0, 1));
    expect(thatDay.kcal).toBeCloseTo(draft.totals.kcal, 1);

    sqlite.close();
  });

  it('repeatFoodEntry re-logs a past meal as of now: entry + items copied, totals doubled', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    const draft = fillMacros(await new StubFoodParser().parse('банан', 'US'));
    const originalId = await saveParsedEntry(db, {
      rawText: 'банан',
      source: 'text',
      draft,
      ts: new Date(Date.now() - 3 * 3600_000), // this morning
    });

    const newId = await repeatFoodEntry(db, originalId);
    expect(newId).not.toBeNull();
    expect(newId).not.toBe(originalId);

    const entries = await listEntriesForDay(db);
    expect(entries).toHaveLength(2);

    const copy = await getFoodEntry(db, newId!);
    const original = await getFoodEntry(db, originalId);
    expect(copy!.entry.rawText).toBe(original!.entry.rawText);
    expect(copy!.entry.kcal).toBeCloseTo(original!.entry.kcal, 5);
    expect(copy!.entry.confirmed).toBe(true);
    expect(copy!.items.map((i) => i.name)).toEqual(original!.items.map((i) => i.name));
    expect(copy!.entry.ts.getTime()).toBeGreaterThan(original!.entry.ts.getTime());

    const totals = await todayMacroTotals(db);
    expect(totals.kcal).toBeCloseTo(draft.totals.kcal * 2, 1);

    sqlite.close();
  });

  it('repeatFoodEntry of a deleted entry returns null, writes nothing', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    expect(await repeatFoodEntry(db, 999)).toBeNull();
    expect(await listEntriesForDay(db)).toHaveLength(0);

    sqlite.close();
  });
});
