import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import {
  listEntriesForDay,
  saveParsedEntry,
  todayMacroTotals,
} from '@/lib/core/db/food';
import * as schema from '@/lib/core/db/schema';
import { StubFoodParser } from '@/lib/core/services/stubFoodParser';

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

describe('food logging (parse → save → totals)', () => {
  it('saves a parsed meal and reflects it in today totals', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    const text = 'омлет из трёх яиц и кофе с молоком';
    const draft = await new StubFoodParser().parse(text, 'RU');
    expect(draft.items.length).toBeGreaterThan(0);

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

  it('only counts entries within the requested day', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    const draft = await new StubFoodParser().parse('банан', 'US');
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
});
