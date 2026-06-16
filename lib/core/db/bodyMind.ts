import { isNotNull } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import {
  bodyMindInsight,
  type BodyMindResult,
  type MoodStepDay,
} from '../insights/bodyMind';
import { diaryEntries, moods, stepsDays } from './schema';
import { dayKey } from './steps';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests). Query builders are awaitable for both.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// Builds the day-by-day (mood, steps) pairs the Body↔Mind insight reads.
///
/// A day qualifies only if it has BOTH a recorded step count and at least one
/// diary entry with a (non-null) mood. Diary moods are averaged per local day;
/// days missing either side are dropped (a missing step row is "no data", not
/// zero — so it must not be paired).
export async function gatherMoodStepDays(db: AnyDb): Promise<MoodStepDay[]> {
  const diaryRows = (await db
    .select({ ts: diaryEntries.ts, mood: diaryEntries.mood })
    .from(diaryEntries)
    .where(isNotNull(diaryEntries.mood))) as { ts: Date; mood: number | null }[];

  const moodRows = (await db
    .select({ ts: moods.ts, value: moods.value })
    .from(moods)) as { ts: Date; value: number }[];

  const stepRows = (await db
    .select({ date: stepsDays.date, steps: stepsDays.steps })
    .from(stepsDays)) as { date: string; steps: number }[];

  // Average ALL moods per local day — diary moods + standalone check-ins — so a
  // one-tap mood feeds the same insight as a full thought record.
  const moodByDay = new Map<string, { sum: number; count: number }>();
  const addMood = (ts: Date, value: number) => {
    const day = dayKey(ts);
    const acc = moodByDay.get(day) ?? { sum: 0, count: 0 };
    acc.sum += Number(value);
    acc.count += 1;
    moodByDay.set(day, acc);
  };
  for (const row of diaryRows) {
    if (row.mood == null) continue; // defensive; the query already filters nulls
    addMood(row.ts, row.mood);
  }
  for (const row of moodRows) addMood(row.ts, row.value);

  const stepsByDay = new Map<string, number>();
  for (const row of stepRows) stepsByDay.set(row.date, Number(row.steps));

  const points: MoodStepDay[] = [];
  for (const [day, m] of moodByDay) {
    const steps = stepsByDay.get(day);
    if (steps == null) continue; // need both sides
    points.push({ day, steps, mood: m.sum / m.count });
  }
  return points;
}

/// Convenience: gather the paired days and run the pure insight over them.
export async function bodyMindInsightFromDb(db: AnyDb): Promise<BodyMindResult> {
  return bodyMindInsight(await gatherMoodStepDays(db));
}
