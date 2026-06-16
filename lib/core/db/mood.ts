import { desc } from 'drizzle-orm';
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

/// The most recent mood check-in, or null if none.
export async function latestMood(db: AnyDb): Promise<MoodRow | null> {
  const rows = (await db.select().from(moods).orderBy(desc(moods.ts)).limit(1)) as MoodRow[];
  return rows.length > 0 ? rows[0] : null;
}
