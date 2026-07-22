import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { saveDiaryEntry, type DiaryDraft } from '@/lib/core/db/diary';
import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { upsertSteps } from '@/lib/core/db/steps';
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
      kcalAvg: 600,
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
      kcalAvg: 0,
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
});
