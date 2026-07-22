import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import { foodEntries } from '@/lib/core/db/schema';
import { macroTotalsByDay } from '@/lib/core/db/food';
import { listMoodsForDay, listMoodsSince, logMood } from '@/lib/core/db/mood';
import { getWeightForDay, upsertWeight } from '@/lib/core/db/weight';
import { listWorkoutsForDay } from '@/lib/core/db/workouts';
import { formatDayTitle, localDayKey, parseDayKey } from '@/lib/i18n/formatDay';
import { formatWorkoutLine, formatWorkoutValue } from '@/lib/i18n/formatWorkout';
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

async function insertWorkout(
  db: ReturnType<typeof makeDb>['db'],
  date: string,
  ts: Date,
  over: {
    type?: string;
    minutes?: number;
    kcal?: number;
    source?: 'manual' | 'ai' | 'tracker' | 'device';
  } = {},
) {
  await db.insert(schema.workouts).values({
    ts,
    date,
    type: over.type ?? 'walk',
    minutes: over.minutes ?? 30,
    kcal: over.kcal ?? 150,
    source: over.source ?? 'manual',
  });
}

/// Stand-in for i18next: real words for the units a line joins, and the KEY
/// itself for anything looked up by name (type, intensity, provenance tag) — so
/// these tests pin the shape of the line, never the wording of the locale.
const tr = (key: string, opts?: Record<string, unknown>): string => {
  if (key === 'workouts.min') return 'мин';
  if (key === 'workouts.kmh') return 'км/ч';
  if (key === 'workouts.setsCount') return `${opts?.count} подх.`;
  if (key === 'units.kcal') return 'ккал';
  return key;
};

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

  it('returns the workouts of a past day, newest first', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    await insertWorkout(db, '2026-07-10', new Date(2026, 6, 10, 8, 0), { minutes: 30 });
    await insertWorkout(db, '2026-07-10', new Date(2026, 6, 10, 19, 0), { minutes: 45 });
    await insertWorkout(db, '2026-07-11', new Date(2026, 6, 11, 7, 0), { minutes: 20 });

    const day1 = await listWorkoutsForDay(db, '2026-07-10');
    expect(day1.map((w) => w.minutes)).toEqual([45, 30]);
    expect(await listWorkoutsForDay(db, '2026-07-12')).toEqual([]);

    sqlite.close();
  });

  it('describes a past workout the way the workouts screen did', () => {
    // «Силовая · 12 подх. · Средняя» — the user's own label wins over the type.
    expect(
      formatWorkoutLine(
        { type: 'strength', minutes: 36, sets: 12, intensity: 'moderate', kcal: 180 },
        tr,
      ),
    ).toBe('workouts.type.strength · 12 подх. · workouts.intensity.moderate');
    expect(
      formatWorkoutLine({ type: 'other', label: '20 приседаний', minutes: 5, kcal: 30 }, tr),
    ).toBe('20 приседаний · 5 мин');
    // A «по трекеру» row has kcal but no duration — no «0 мин» tail.
    expect(formatWorkoutLine({ type: 'other', minutes: 0, kcal: 300 }, tr)).toBe(
      'workouts.type.other',
    );
    // Pace rides along, and an imported session says where it came from.
    expect(
      formatWorkoutLine({ type: 'run', minutes: 40, speedKmh: 9.55, source: 'device', kcal: 400 }, tr),
    ).toBe('workouts.type.run · 40 мин · 9.6 км/ч · workouts.fromDevice');
  });

  it('marks EVERY burn with «≈» and drops it entirely under hideCalories', () => {
    // Our own MET math — an estimate, and rounded.
    expect(formatWorkoutValue({ type: 'walk', minutes: 30, kcal: 120.4 }, tr, false)).toBe(
      '≈ 120 ккал',
    );
    expect(formatWorkoutValue({ type: 'other', minutes: 10, kcal: 55 }, tr, false)).toBe('≈ 55 ккал');
    // A device session gets the tilde too, whether the store priced it or we did.
    // Wrist wearables miss energy expenditure by >30% MAPE against indirect
    // calorimetry (Apple Watch 15–211%), with no consistent direction — so the
    // old «device number = measurement» hierarchy had no support.
    expect(
      formatWorkoutValue({ type: 'run', minutes: 30, kcal: 300, source: 'device', kcalFrom: 'device' }, tr, false),
    ).toBe('≈ 300 ккал');
    expect(
      formatWorkoutValue({ type: 'run', minutes: 30, kcal: 300, source: 'device', kcalFrom: 'met' }, tr, false),
    ).toBe('≈ 300 ккал');
    // Same for a figure copied off a watch face by hand.
    expect(
      formatWorkoutValue({ type: 'other', minutes: 0, kcal: 412, source: 'tracker' }, tr, false),
    ).toBe('≈ 412 ккал');
    // «Скрыть калории»: the row keeps its line, loses only the number.
    expect(formatWorkoutValue({ type: 'walk', minutes: 30, kcal: 120 }, tr, true)).toBeNull();
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
