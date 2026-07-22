import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { selfInitiatedLogDays } from '@/lib/core/db/activity';
import { saveDiaryEntry, type DiaryDraft } from '@/lib/core/db/diary';
import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { dayKey, upsertSteps } from '@/lib/core/db/steps';
import { logDaysInRange, weeklyStreak } from '@/lib/core/insights/engagement';

// 2026-06-17 is a Wednesday; its Mon–Sun week is 2026-06-15 … 06-21.
const today = new Date(2026, 5, 17, 12);
const daysAgo = (n: number): string => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return dayKey(d);
};

describe('weeklyStreak', () => {
  it('counts consecutive qualifying weeks including the current one', () => {
    const logDays = new Set([daysAgo(0), daysAgo(7), daysAgo(14)]);
    expect(weeklyStreak(logDays, today)).toEqual({
      weeks: 3,
      currentWeekDays: 1,
      currentWeekQualified: true,
    });
  });

  it('keeps the streak through a quiet (not-yet-logged) current week', () => {
    const logDays = new Set([daysAgo(7), daysAgo(14)]);
    expect(weeklyStreak(logDays, today)).toEqual({
      weeks: 2,
      currentWeekDays: 0,
      currentWeekQualified: false,
    });
  });

  it('breaks only when a whole week is missed', () => {
    // current week logged, previous week empty, two-weeks-ago logged.
    const logDays = new Set([daysAgo(0), daysAgo(14)]);
    expect(weeklyStreak(logDays, today)).toMatchObject({ weeks: 1 });
  });

  it('is zero when nothing has been logged', () => {
    expect(weeklyStreak(new Set(), today)).toEqual({
      weeks: 0,
      currentWeekDays: 0,
      currentWeekQualified: false,
    });
  });
});

describe('logDaysInRange', () => {
  it('counts distinct log days within [start, end)', () => {
    const logDays = new Set([daysAgo(0), daysAgo(1), daysAgo(7)]);
    const weekStart = new Date(2026, 5, 15);
    const weekEnd = new Date(2026, 5, 22);
    // daysAgo(0)=06-17 and daysAgo(1)=06-16 are in-week; daysAgo(7)=06-10 is not.
    expect(logDaysInRange(logDays, weekStart, weekEnd)).toBe(2);
  });
});

describe('selfInitiatedLogDays', () => {
  it('collects food + diary days and excludes passive steps', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    const db = drizzle(sqlite, { schema });
    await applySchema((s) => sqlite.exec(s));

    await db.insert(schema.foodEntries).values({
      ts: new Date(2026, 5, 16, 9),
      rawText: 'x',
      source: 'text',
      kcal: 0,
      proteinG: 0,
      fatG: 0,
      carbG: 0,
      confirmed: true,
    });
    const draft: DiaryDraft = {
      situation: '',
      thoughts: '',
      emotions: [],
      reactionBody: '',
      reactionBehavior: '',
      evidenceFor: '',
      evidenceAgainst: '',
      reframe: '',
      mood: 5,
    };
    await saveDiaryEntry(db, draft, new Date(2026, 5, 17, 10));
    await saveDiaryEntry(db, draft, new Date(2026, 5, 17, 20)); // same day → one key
    await upsertSteps(db, '2026-06-18', 9000); // passive → excluded

    const days = await selfInitiatedLogDays(db);
    expect([...days].sort()).toEqual(['2026-06-16', '2026-06-17']);
    sqlite.close();
  });

  it('counts a hand-logged workout — a day spent only training is not empty', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    const db = drizzle(sqlite, { schema });
    await applySchema((s) => sqlite.exec(s));

    await logWorkout(db, '2026-06-16', 'manual');
    await logWorkout(db, '2026-06-17', 'ai'); // described in free text / voice
    await logWorkout(db, '2026-06-18', 'tracker'); // kcal copied off a watch screen
    await logWorkout(db, '2026-06-18', 'manual'); // same day twice → one key

    const days = await selfInitiatedLogDays(db);
    expect([...days].sort()).toEqual(['2026-06-16', '2026-06-17', '2026-06-18']);
    sqlite.close();
  });

  it('excludes an auto-imported (device) session — a sleeping phone must not hold a streak', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    const db = drizzle(sqlite, { schema });
    await applySchema((s) => sqlite.exec(s));

    await logWorkout(db, '2026-06-16', 'device');
    expect([...(await selfInitiatedLogDays(db))]).toEqual([]);

    // The same day gains a hand-logged one → now it counts, exactly once.
    await logWorkout(db, '2026-06-16', 'manual');
    expect([...(await selfInitiatedLogDays(db))]).toEqual(['2026-06-16']);
    sqlite.close();
  });
});

/// One workout row on a day key, by source. Mirrors what the workout writers
/// store: `date` is the day the row is grouped by everywhere in the app.
function logWorkout(
  db: ReturnType<typeof drizzle>,
  date: string,
  source: 'manual' | 'ai' | 'tracker' | 'device',
) {
  const [y, m, d] = date.split('-').map(Number);
  return db.insert(schema.workouts).values({
    ts: new Date(y, m - 1, d, 19),
    date,
    type: 'strength',
    minutes: 30,
    kcal: 150,
    source,
  });
}
