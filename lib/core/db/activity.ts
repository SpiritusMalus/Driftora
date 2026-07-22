import { inArray } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { diaryEntries, foodEntries, moods, workouts } from './schema';
import { dayKey } from './steps';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests). Query builders are awaitable for both.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// Workout sources that a HUMAN started: the chip form, the free-text/voice AI
/// parse, and a number copied off a tracker screen. Excludes 'device' — those
/// rows appear on their own from a watch sync, and a streak that a sleeping
/// phone can extend measures the watch, not the person.
const SELF_INITIATED_WORKOUT_SOURCES: ('manual' | 'ai' | 'tracker')[] = ['manual', 'ai', 'tracker'];

/// The set of local 'YYYY-MM-DD' days that had at least one **self-initiated**
/// log — a food entry, a diary entry, a mood check-in or a hand-logged workout.
/// Passive data (steps, synced from the OS) is deliberately excluded: the
/// north-star and streak reward *showing up*, not the device syncing in the
/// background.
///
/// Workouts were missing here until now, so a day spent only training read as
/// empty and BROKE the streak — the one day the user did the most physical work.
/// They're taken by their stored `date` (the day key every other workout surface
/// groups by, and the session's START day for imports), not by `dayKey(ts)`.
export async function selfInitiatedLogDays(db: AnyDb): Promise<Set<string>> {
  const [food, diary, mood, workout] = await Promise.all([
    db.select({ ts: foodEntries.ts }).from(foodEntries),
    db.select({ ts: diaryEntries.ts }).from(diaryEntries),
    db.select({ ts: moods.ts }).from(moods),
    db
      .select({ date: workouts.date })
      .from(workouts)
      .where(inArray(workouts.source, SELF_INITIATED_WORKOUT_SOURCES)),
  ]);
  const days = new Set<string>();
  for (const row of [...food, ...diary, ...mood]) days.add(dayKey(row.ts as Date));
  for (const row of workout) days.add(row.date as string);
  return days;
}
