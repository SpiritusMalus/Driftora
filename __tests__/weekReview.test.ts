import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { saveDiaryEntry, type DiaryDraft } from '@/lib/core/db/diary';
import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { updateSettings } from '@/lib/core/db/settings';
import { upsertSteps } from '@/lib/core/db/steps';
import { upsertWeight } from '@/lib/core/db/weight';
import { dayBudgetKcal, restingPlan, stepsEarnedKcal } from '@/lib/core/insights/bodyMetrics';
import { weekReview } from '@/lib/core/db/weekReview';

// 2026-06-17 is a Wednesday → this week is 06-15…06-21, last week 06-08…06-14.
const today = new Date(2026, 5, 17, 12);

/// A logged session on a day key. `date` (not `ts`) is what the review ranges
/// on, so the fixture pins both the way the app stores them.
function workout(
  db: ReturnType<typeof drizzle>,
  date: string,
  minutes: number,
  source: 'manual' | 'ai' | 'tracker' | 'device' = 'manual',
) {
  const [y, m, d] = date.split('-').map(Number);
  return db.insert(schema.workouts).values({
    ts: new Date(y, m - 1, d, 18),
    date,
    type: 'walk',
    minutes,
    kcal: minutes * 5,
    source,
  });
}

function emptyDraft(): DiaryDraft {
  return {
    situation: '',
    thoughts: '',
    emotions: [],
    reactionBody: '',
    reactionBehavior: '',
    evidenceFor: '',
    evidenceAgainst: '',
    reframe: 'ok',
    mood: 6,
  };
}

describe('weekReview', () => {
  it('aggregates this week vs last week with the streak and north-star', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    const db = drizzle(sqlite, { schema });
    await applySchema((s) => sqlite.exec(s));

    // Steps: this week two days (avg 7000), last week one day (4000).
    await upsertSteps(db, '2026-06-15', 6000);
    await upsertSteps(db, '2026-06-16', 8000);
    await upsertSteps(db, '2026-06-09', 4000);

    // Food: this week two days (protein avg 40, kcal avg 600), last week one day.
    const food = (day: number, kcal: number, proteinG: number) =>
      db.insert(schema.foodEntries).values({
        ts: new Date(2026, 5, day, 12),
        rawText: 'meal',
        source: 'text',
        kcal,
        proteinG,
        fatG: 0,
        carbG: 0,
        confirmed: true,
      });
    await food(15, 500, 30);
    await food(16, 700, 50);
    await food(10, 400, 20); // last week

    await saveDiaryEntry(db, emptyDraft(), new Date(2026, 5, 17, 10)); // this week
    await db.insert(schema.wins).values({ kind: 'manual', message: 'w', ts: new Date(2026, 5, 16, 12) });

    // Workouts: this week 3 sessions over 2 days (30+50 and 40 → avg 60/day),
    // last week one 20-min session.
    await workout(db, '2026-06-15', 30);
    await workout(db, '2026-06-15', 50);
    await workout(db, '2026-06-17', 40);
    await workout(db, '2026-06-11', 20); // last week

    const r = await weekReview(db, today);

    expect(r.weekStart).toBe('2026-06-15');
    expect(r.thisWeek).toEqual({
      stepsAvg: 7000,
      stepsDayCount: 2,
      proteinAvg: 40,
      // Fixtures store no micros blob → no fiber data, honestly zero.
      fiberAvg: 0,
      kcalAvg: 600,
      // Фикстуры не задают цель и профиль — норму считать не из чего,
      // поэтому недобор/перебор честно отсутствует.
      kcalBalanceAvg: null,
      foodLogDays: 2,
      diaryCount: 1,
      winsCount: 1,
      workoutCount: 3,
      // 120 minutes over the 2 days that HAD a workout — the other five days of
      // the week are rest, not zeros.
      workoutMinutesAvg: 60,
    });
    expect(r.lastWeek).toMatchObject({
      stepsAvg: 4000,
      proteinAvg: 20,
      foodLogDays: 1,
      diaryCount: 0,
      winsCount: 0,
      workoutCount: 1,
      workoutMinutesAvg: 20,
    });
    // Self-initiated log days this week: food 06-15, 06-16 + diary 06-17 = 3.
    // The workouts sit on 06-15 and 06-17 — already counted days, so they add
    // nothing: a day is a day however many ways it was logged.
    expect(r.northStarThisWeek).toBe(3);
    // Logs this week and last week (06-10) → 2-week forgiving streak.
    expect(r.streakWeeks).toBe(2);
    sqlite.close();
  });

  it('is all-zeros on an empty database', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    const db = drizzle(sqlite, { schema });
    await applySchema((s) => sqlite.exec(s));

    const r = await weekReview(db, today);
    expect(r.thisWeek).toEqual({
      stepsAvg: 0,
      stepsDayCount: 0,
      proteinAvg: 0,
      fiberAvg: 0,
      kcalAvg: 0,
      // Фикстуры не задают цель и профиль — норму считать не из чего,
      // поэтому недобор/перебор честно отсутствует.
      kcalBalanceAvg: null,
      foodLogDays: 0,
      diaryCount: 0,
      winsCount: 0,
      workoutCount: 0,
      workoutMinutesAvg: 0,
    });
    expect(r.northStarThisWeek).toBe(0);
    expect(r.streakWeeks).toBe(0);
    sqlite.close();
  });

  it('does not average a photo that never parsed into the week', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    const db = drizzle(sqlite, { schema });
    await applySchema((s) => sqlite.exec(s));

    // Two real days at 2000 kcal…
    for (const day of [15, 16]) {
      await db.insert(schema.foodEntries).values({
        ts: new Date(2026, 5, day, 12),
        rawText: 'обед',
        source: 'text',
        kcal: 2000,
        proteinG: 100,
        fatG: 0,
        carbG: 0,
        confirmed: true,
      });
    }
    // …and a third day whose only rows are background-parse placeholders: one
    // still spinning, one that died with its process. Both carry zero macros and
    // no text — the user photographed a meal and got nothing back.
    for (const status of ['pending', 'failed'] as const) {
      await db.insert(schema.foodEntries).values({
        ts: new Date(2026, 5, 17, 13),
        rawText: '',
        source: 'photo',
        kcal: 0,
        proteinG: 0,
        fatG: 0,
        carbG: 0,
        confirmed: false,
        parseStatus: status,
      });
    }

    const r = await weekReview(db, today);
    // Two days logged, not three — and the averages stay at what was eaten.
    expect(r.thisWeek.foodLogDays).toBe(2);
    expect(r.thisWeek.kcalAvg).toBe(2000);
    expect(r.thisWeek.proteinAvg).toBe(100);
    sqlite.close();
  });

  it('averages fiber from the stored micros blobs, per day with food', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    const db = drizzle(sqlite, { schema });
    await applySchema((s) => sqlite.exec(s));

    const meal = (day: number, micros: string | null) =>
      db.insert(schema.foodEntries).values({
        ts: new Date(2026, 5, day, 12),
        rawText: 'meal',
        source: 'text',
        kcal: 500,
        proteinG: 20,
        fatG: 0,
        carbG: 0,
        confirmed: true,
        micros,
      });
    // Day 15: two meals, 8 + 4 g. Day 16: one meal from before fiber existed in
    // the data (no blob) — counts as 0, the denominator stays the food days.
    await meal(15, JSON.stringify({ fiber: 8 }));
    await meal(15, JSON.stringify({ fiber: 4 }));
    await meal(16, null);

    const r = await weekReview(db, today);
    expect(r.thisWeek.fiberAvg).toBe(6); // (12 + 0) / 2 days
    sqlite.close();
  });

  it('counts a watch-imported session too — the review is the week the body had', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    const db = drizzle(sqlite, { schema });
    await applySchema((s) => sqlite.exec(s));

    await workout(db, '2026-06-16', 45, 'device');
    await workout(db, '2026-06-18', 15, 'tracker');
    // Outside the week — must not leak in.
    await workout(db, '2026-06-22', 90);

    const r = await weekReview(db, today);
    expect(r.thisWeek.workoutCount).toBe(2);
    expect(r.thisWeek.workoutMinutesAvg).toBe(30);
    // ...but a watch session alone never props up the self-initiated north-star.
    expect(r.northStarThisWeek).toBe(1);
    sqlite.close();
  });

  // «Сколько я недоел или переел» — то, чего в статистике не было: средние ккал
  // стояли без нормы. Норма берётся ПОДНЕВНО (у дня с прогулкой она выше), и
  // сравнение идёт только по дням с едой.
  it('averages the under/over against each day\'s own budget', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    const db = drizzle(sqlite, { schema });
    await applySchema((s) => sqlite.exec(s));

    await updateSettings(db, {
      sex: 'male',
      birthYear: 1990,
      heightCm: 175,
      goalMode: 'lose',
      deficitTempo: 'standard',
      // Колонка — обычный integer, а не timestamp: пишем epoch-мс, как приложение.
      targetsSetAt: new Date(2026, 5, 1).getTime(),
    });
    await upsertWeight(db, new Date(2026, 5, 15), 80);

    // Два дня с едой и РАЗНЫМ движением: если бы норма усреднялась по неделе,
    // разница между этими днями пропала бы — а она и есть предмет замера.
    await upsertSteps(db, '2026-06-15', 3000); // ровно базовый порог: ноль сверх покоя
    await upsertSteps(db, '2026-06-16', 13000);
    const food = (day: number, kcal: number) =>
      db.insert(schema.foodEntries).values({
        ts: new Date(2026, 5, day, 12),
        rawText: 'meal',
        source: 'text',
        kcal,
        proteinG: 0,
        fatG: 0,
        carbG: 0,
        confirmed: true,
      });
    await food(15, 1500);
    await food(16, 2600);

    const r = await weekReview(db, today);

    const plan = restingPlan(
      { sex: 'male', birthYear: 1990, heightCm: 175, activityLevel: 'sedentary', bodyFatPct: 0, waistCm: 0, bmrFactor: 0 },
      80,
      'lose',
      new Date(2026, 5, 15),
      0,
      'standard',
    );
    expect(plan).not.toBeNull();
    const target15 = dayBudgetKcal(plan!.baseKcal, plan!.minDayKcal, stepsEarnedKcal(3000, 80));
    const target16 = dayBudgetKcal(plan!.baseKcal, plan!.minDayKcal, stepsEarnedKcal(13000, 80));
    expect(r.thisWeek.kcalBalanceAvg).toBe(
      Math.round((1500 - target15 + (2600 - target16)) / 2),
    );
  });

  // Без цели норму считать не из чего — молчим, а не показываем ноль.
  it('leaves the under/over empty when no goal is set', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    const db = drizzle(sqlite, { schema });
    await applySchema((s) => sqlite.exec(s));
    await db.insert(schema.foodEntries).values({
      ts: new Date(2026, 5, 15, 12),
      rawText: 'meal',
      source: 'text',
      kcal: 1500,
      proteinG: 0,
      fatG: 0,
      carbG: 0,
      confirmed: true,
    });
    const r = await weekReview(db, today);
    expect(r.thisWeek.kcalBalanceAvg).toBeNull();
  });

});
