import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import {
  getFoodEntry,
  listEntriesForDay,
  listItemsForEntries,
  repeatFoodEntry,
  saveParsedEntry,
  todayMacroTotals,
  updateFoodEntry,
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
  it('refuses an entirely unknown draft before creating any stored entry', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));
    const draft = await new StubFoodParser().parse('rice 100 g', 'US');
    await expect(saveParsedEntry(db, { rawText: 'rice 100 g', source: 'text', draft })).rejects.toThrow('Food nutrition is incomplete');
    expect(await listEntriesForDay(db)).toHaveLength(0);
    expect(await todayMacroTotals(db)).toEqual({ kcal: 0, proteinG: 0, fatG: 0, carbG: 0 });
    sqlite.close();
  });

  it('can save explicitly known zero nutrition without confusing it with a missing composition', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));
    const parsed = await new StubFoodParser().parse('water 100 g', 'US');
    const draft = withItemManualMacros(parsed, 0, { prot: 0, fat: 0, carb: 0, kcal: 0 });
    const id = await saveParsedEntry(db, { rawText: 'water 100 g', source: 'text', draft });
    const detail = await getFoodEntry(db, id);
    expect(detail!.entry.confirmed).toBe(true);
    expect(detail!.items).toHaveLength(1);
    expect(detail!.items[0].qtyG).toBe(100);
    expect(detail!.items[0].source).toBe('manual');
    sqlite.close();
  });

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

  it('rejects unresolved meals without saving confirmed zeros or dropping their items', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    // Two items: a banana the user fills in (manual) and an unfilled "пончик" miss.
    const parsed = await new StubFoodParser().parse('банан, пончик', 'RU');
    expect(parsed.items.length).toBe(2);
    const draft = withItemManualMacros(parsed, 0, { kcal: 89, prot: 1.1, fat: 0.3, carb: 23 });
    // Total reflects only the filled banana; the unfilled пончик is excluded.
    expect(draft.totals.kcal).toBeGreaterThan(0);

    await expect(saveParsedEntry(db, { rawText: 'банан, пончик', source: 'text', draft })).rejects.toThrow('Food nutrition is incomplete');
    expect(await listEntriesForDay(db)).toHaveLength(0);
    expect(draft.items).toHaveLength(2);
    expect(draft.items[1].per100.source).toBe('estimate');

    // Once the unresolved item is filled, both components survive saving.
    const resolved = withItemManualMacros(draft, 1, { prot: 5, fat: 8, carb: 30 });
    const id = await saveParsedEntry(db, { rawText: 'банан, пончик', source: 'text', draft: resolved });

    const detail = await getFoodEntry(db, id);
    expect(detail!.items).toHaveLength(2);
    expect(detail!.items[0].name).toContain('Банан');
    const totals = await todayMacroTotals(db);
    expect(totals.kcal).toBeCloseTo(resolved.totals.kcal, 1);

    sqlite.close();
  });

  it('listItemsForEntries groups breakdowns by entry; single-figure meals stay absent', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    // Two complete meals and one legacy entry without an item breakdown.
    // Old rows remain readable; new unresolved meals cannot create them.
    const first = fillMacros(await new StubFoodParser().parse('банан, кофе', 'RU'));
    const second = fillMacros(await new StubFoodParser().parse('омлет', 'RU'));
    const firstId = await saveParsedEntry(db, { rawText: 'банан, кофе', source: 'text', draft: first });
    const secondId = await saveParsedEntry(db, { rawText: 'омлет', source: 'text', draft: second });
    const [legacy] = await db.insert(schema.foodEntries).values({
      ts: new Date(), rawText: 'legacy', source: 'text', kcal: 120,
      proteinG: 0, fatG: 0, carbG: 0, confirmed: true,
    }).returning({ id: schema.foodEntries.id });
    const bareId = legacy.id;

    const byEntry = await listItemsForEntries(db, [firstId, secondId, bareId]);
    expect(byEntry.get(firstId)).toHaveLength(2);
    expect(byEntry.get(secondId)).toHaveLength(1);
    expect(byEntry.has(bareId)).toBe(false);
    // One query, keyed correctly — items never leak across entries.
    expect(byEntry.get(firstId)!.every((it) => it.entryId === firstId)).toBe(true);

    // Empty input short-circuits without touching the database.
    expect((await listItemsForEntries(db, [])).size).toBe(0);

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

    // Anchor both the original and the re-log to a fixed, non-boundary time of
    // day so the test doesn't flake when run near local midnight (a relative
    // "3h ago" could land on the previous day). Noon and 9am share a local day.
    const day = new Date(2020, 0, 1, 12, 0, 0); // "now" for the re-log
    const morning = new Date(2020, 0, 1, 9, 0, 0); // original meal, same day

    const draft = fillMacros(await new StubFoodParser().parse('банан', 'US'));
    const originalId = await saveParsedEntry(db, {
      rawText: 'банан',
      source: 'text',
      draft,
      ts: morning,
    });

    const newId = await repeatFoodEntry(db, originalId, day);
    expect(newId).not.toBeNull();
    expect(newId).not.toBe(originalId);

    const entries = await listEntriesForDay(db, day);
    expect(entries).toHaveLength(2);

    const copy = await getFoodEntry(db, newId!);
    const original = await getFoodEntry(db, originalId);
    expect(copy!.entry.rawText).toBe(original!.entry.rawText);
    expect(copy!.entry.kcal).toBeCloseTo(original!.entry.kcal, 5);
    expect(copy!.entry.confirmed).toBe(true);
    expect(copy!.items.map((i) => i.name)).toEqual(original!.items.map((i) => i.name));
    expect(copy!.entry.ts.getTime()).toBeGreaterThan(original!.entry.ts.getTime());

    const totals = await todayMacroTotals(db, day);
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

  it('stores the user-picked meal; a repeat copy deliberately drops it', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    const day = new Date(2020, 0, 1, 12, 0, 0);
    const morning = new Date(2020, 0, 1, 11, 41, 0); // the «поздний завтрак» case
    const draft = fillMacros(await new StubFoodParser().parse('банан', 'US'));
    const id = await saveParsedEntry(db, {
      rawText: 'банан',
      source: 'text',
      draft,
      ts: morning,
      meal: 'breakfast',
    });
    expect((await getFoodEntry(db, id))!.entry.meal).toBe('breakfast');
    // Without a pick nothing is stored — the day view keeps its clock fallback.
    const noPickId = await saveParsedEntry(db, { rawText: 'кофе', source: 'text', draft, ts: morning });
    expect((await getFoodEntry(db, noPickId))!.entry.meal).toBeNull();
    // The repeat happens at a NEW time of day → its meal is re-derived from the
    // clock by the day view, not inherited from the original's завтрак.
    const copyId = await repeatFoodEntry(db, id, day);
    expect((await getFoodEntry(db, copyId!))!.entry.meal).toBeNull();

    // Re-filing via update: обед → ужин sticks; an omitted meal leaves it alone.
    await updateFoodEntry(db, id, { rawText: 'банан', source: 'text', draft, meal: 'dinner' });
    expect((await getFoodEntry(db, id))!.entry.meal).toBe('dinner');
    await updateFoodEntry(db, id, { rawText: 'банан', source: 'text', draft });
    expect((await getFoodEntry(db, id))!.entry.meal).toBe('dinner');

    sqlite.close();
  });
});
