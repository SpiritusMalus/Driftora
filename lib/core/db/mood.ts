import { and, desc, gte, lt } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { moods, type MoodRow } from './schema';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests). Query builders are awaitable for both.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// Logs a standalone mood check-in (0–10). Multiple per day are allowed — the
/// Body↔Mind insight averages them with any diary moods for that day.
export async function logMood(db: AnyDb, value: number, ts: Date = new Date()): Promise<void> {
  await db.insert(moods).values({ value, ts });
}

/// Mood check-ins newest-first, optionally capped to [limit].
export async function listMoods(db: AnyDb, limit?: number): Promise<MoodRow[]> {
  const query = db.select().from(moods).orderBy(desc(moods.ts));
  return (await (limit != null ? query.limit(limit) : query)) as MoodRow[];
}

/// Check-ins made on [date]'s local day, newest first — the day-history view.
export async function listMoodsForDay(
  db: AnyDb,
  date: Date = new Date(),
): Promise<MoodRow[]> {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return (await db
    .select()
    .from(moods)
    .where(and(gte(moods.ts, start), lt(moods.ts, end)))
    .orderBy(desc(moods.ts))) as MoodRow[];
}

/// Check-ins since [start], newest first — one range query for the day-history
/// list, grouped by day on the caller's side.
export async function listMoodsSince(db: AnyDb, start: Date): Promise<MoodRow[]> {
  return (await db
    .select()
    .from(moods)
    .where(gte(moods.ts, start))
    .orderBy(desc(moods.ts))) as MoodRow[];
}

/// The most recent mood check-in, or null if none.
export async function latestMood(db: AnyDb): Promise<MoodRow | null> {
  const rows = (await db.select().from(moods).orderBy(desc(moods.ts)).limit(1)) as MoodRow[];
  return rows.length > 0 ? rows[0] : null;
}
