import { describe, expect, it, jest } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

jest.mock('@/lib/core/services/tempFiles', () => ({ deleteTempFile: jest.fn() }));

import { applySchema } from '@/lib/core/db/init';
import {
  confirmFoodEntry,
  getFoodEntry,
  listEntriesForDay,
  markPendingFailed,
  savePendingEntry,
  sweepStalePendingEntries,
} from '@/lib/core/db/food';
import * as schema from '@/lib/core/db/schema';
import { retryParse, runAdoptedParse } from '@/lib/core/services/backgroundParses';
import type { MealDraft, PhotoInput } from '@/lib/core/services/foodParser';
import { withItemManualMacros } from '@/lib/core/services/mealDraft';
import { StubFoodParser } from '@/lib/core/services/stubFoodParser';

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

const photo = { uri: 'file:///cache/shot.jpg' } as PhotoInput;

/// A draft the adopted path can actually save: stub items are 'estimate'
/// placeholders (dropped on insert), so fill them → 'manual', and clear the
/// offline flag — the adopted path treats an offline fallback as unusable.
async function usableDraft(): Promise<MealDraft> {
  let d = await new StubFoodParser().parse('гречка с курицей', 'RU');
  for (let i = 0; i < d.items.length; i++) {
    d = withItemManualMacros(d, i, { kcal: 120, prot: 10, fat: 5, carb: 8 });
  }
  return { ...d, flags: { ...d.flags, offline_fallback: false } };
}

describe('background parse entries (db lifecycle)', () => {
  it('savePendingEntry: a zero-macro «разбирается…» row, unconfirmed', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));
    const id = await savePendingEntry(db, { source: 'photo', meal: 'lunch' });
    const rows = await listEntriesForDay(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].parseStatus).toBe('pending');
    expect(rows[0].kcal).toBe(0);
    expect(rows[0].confirmed).toBe(false);
    expect(rows[0].meal).toBe('lunch');
  });

  it('adopted success: entry fills but stays UNCONFIRMED until opened', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));
    const id = await savePendingEntry(db, { source: 'photo' });
    await runAdoptedParse(db, id, usableDraft(), { region: 'RU', photo });
    const detail = await getFoodEntry(db, id);
    expect(detail).not.toBeNull();
    expect(detail!.entry.parseStatus).toBeNull();
    expect(detail!.entry.kcal).toBeGreaterThan(0);
    expect(detail!.entry.rawText.length).toBeGreaterThan(0);
    expect(detail!.items.length).toBeGreaterThan(0);
    // The hybrid contract: an adopted result is a fact on the list, but review
    // is only deferred — confirmed flips when a human opens the entry.
    expect(detail!.entry.confirmed).toBe(false);
    await confirmFoodEntry(db, id);
    const after = await getFoodEntry(db, id);
    expect(after!.entry.confirmed).toBe(true);
  });

  it('adopted offline/empty draft: retry-able failed, macros stay zero', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));
    const id = await savePendingEntry(db, { source: 'photo' });
    // The raw stub draft IS the offline fallback — unusable for an adopted photo.
    await runAdoptedParse(db, id, new StubFoodParser().parse('борщ', 'RU'), { region: 'RU', photo });
    const detail = await getFoodEntry(db, id);
    expect(detail!.entry.parseStatus).toBe('failed');
    expect(detail!.entry.kcal).toBe(0);
  });

  it('adopted parse that throws: failed, never a forever-spinner', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));
    const id = await savePendingEntry(db, { source: 'photo' });
    await runAdoptedParse(db, id, Promise.reject(new Error('boom')), { region: 'RU', photo });
    const detail = await getFoodEntry(db, id);
    expect(detail!.entry.parseStatus).toBe('failed');
  });

  it('sweep: stale pending → failed, fresh pending survives', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));
    const stale = await savePendingEntry(db, {
      source: 'photo',
      ts: new Date(Date.now() - 60 * 60_000),
    });
    const fresh = await savePendingEntry(db, { source: 'photo' });
    await sweepStalePendingEntries(db);
    expect((await getFoodEntry(db, stale))!.entry.parseStatus).toBe('failed');
    expect((await getFoodEntry(db, fresh))!.entry.parseStatus).toBe('pending');
  });

  it('retryParse without kept photo (process restarted): honest false', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));
    const id = await savePendingEntry(db, { source: 'photo' });
    await markPendingFailed(db, id);
    expect(await retryParse(db, id)).toBe(false);
  });
});
