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
    });
    expect(r.lastWeek).toMatchObject({
      stepsAvg: 4000,
      proteinAvg: 20,
      foodLogDays: 1,
      diaryCount: 0,
      winsCount: 0,
    });
    // Self-initiated log days this week: food 06-15, 06-16 + diary 06-17 = 3.
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
    });
    expect(r.northStarThisWeek).toBe(0);
    expect(r.streakWeeks).toBe(0);
    sqlite.close();
  });
});
