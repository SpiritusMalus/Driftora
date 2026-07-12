import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import { foodEntries } from '@/lib/core/db/schema';
import { macroTotalsByDay } from '@/lib/core/db/food';
import { listMoodsForDay, listMoodsSince, logMood } from '@/lib/core/db/mood';
import { getWeightForDay, upsertWeight } from '@/lib/core/db/weight';
import { formatDayTitle, localDayKey, parseDayKey } from '@/lib/i18n/formatDay';
import * as schema from '@/lib/core/db/schema';

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

/// Anchored to a fixed mid-day date, never Date.now() — the repeatFoodEntry
/// suite once flaked around midnight (PR #110) because relative timestamps
/// slid into «yesterday». All rows here pin explicit days at 09:00–13:00.
const DAY1 = new Date(2026, 6, 10, 12, 0); // 2026-07-10
const DAY2 = new Date(2026, 6, 11, 9, 30); // 2026-07-11
const NOW = new Date(2026, 6, 12, 13, 0); // 2026-07-12 «today»

async function insertEntry(db: ReturnType<typeof makeDb>['db'], ts: Date, kcal: number, prot: number) {
  await db.insert(foodEntries).values({
    ts,
    rawText: 'тестовая еда',
    source: 'text',
    kcal,
    proteinG: prot,
    fatG: 5,
    carbG: 20,
    confirmed: true,
  });
}

describe('day history (выбрать прошлый день и посмотреть логи)', () => {
  it('groups macro totals by local day over the window', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    await insertEntry(db, DAY1, 500, 30);
    await insertEntry(db, DAY1, 300, 20);
    await insertEntry(db, DAY2, 700, 40);

    const byDay = await macroTotalsByDay(db, 30, NOW);
    expect(byDay.get(localDayKey(DAY1))).toMatchObject({ kcal: 800, proteinG: 50 });
    expect(byDay.get(localDayKey(DAY2))).toMatchObject({ kcal: 700, proteinG: 40 });
    // The empty «today» is simply absent — the screen treats that as no food.
    expect(byDay.get(localDayKey(NOW))).toBeUndefined();

    sqlite.close();
  });

  it('keeps days outside the window out of the map', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    const old = new Date(2026, 4, 1, 12, 0); // 2026-05-01, far outside 30 days
    await insertEntry(db, old, 999, 99);
    await insertEntry(db, DAY2, 700, 40);

    const byDay = await macroTotalsByDay(db, 30, NOW);
    expect(byDay.has(localDayKey(old))).toBe(false);
    expect(byDay.has(localDayKey(DAY2))).toBe(true);

    sqlite.close();
  });

  it('scopes mood check-ins to one local day and to a since-window', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    await logMood(db, 4, DAY1);
    await logMood(db, 7, new Date(2026, 6, 10, 21, 0)); // same day, evening
    await logMood(db, 9, DAY2);

    const day1 = await listMoodsForDay(db, DAY1);
    expect(day1.map((m) => m.value)).toEqual([7, 4]); // newest first
    const day2 = await listMoodsForDay(db, DAY2);
    expect(day2.map((m) => m.value)).toEqual([9]);

    const since = await listMoodsSince(db, new Date(2026, 6, 11));
    expect(since.map((m) => m.value)).toEqual([9]);

    sqlite.close();
  });

  it('returns the weigh-in stored for a day key', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    await upsertWeight(db, '2026-07-10', 92.4, DAY1);
    expect((await getWeightForDay(db, '2026-07-10'))?.weightKg).toBe(92.4);
    expect(await getWeightForDay(db, '2026-07-11')).toBeNull();

    sqlite.close();
  });

  it('formats day titles: today / yesterday / date with weekday key', () => {
    const t = (k: string) =>
      (({ 'history.today': 'Сегодня', 'history.yesterday': 'Вчера', 'history.m7': 'июля', 'history.w5': 'пятница' }) as Record<string, string>)[k] ?? k;
    expect(formatDayTitle('2026-07-12', t, NOW)).toBe('Сегодня');
    expect(formatDayTitle('2026-07-11', t, NOW)).toBe('Вчера');
    // 2026-07-10 is a Friday → w5.
    expect(formatDayTitle('2026-07-10', t, NOW)).toBe('10 июля, пятница');
    expect(parseDayKey('garbage')).toBeNull();
  });
});
