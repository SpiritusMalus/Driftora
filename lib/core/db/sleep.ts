import { eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type { HealthService } from '../services/health';
import { sleepDays } from './schema';
import { dayKey } from './steps';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests). Query builders are awaitable for both.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// Inserts or updates the sleep minutes for a day (one row per 'YYYY-MM-DD').
export async function upsertSleep(
  db: AnyDb,
  day: Date | string,
  minutes: number,
  syncedAt: Date = new Date(),
): Promise<void> {
  const date = typeof day === 'string' ? day : dayKey(day);
  await db
    .insert(sleepDays)
    .values({ date, minutes, syncedAt })
    .onConflictDoUpdate({ target: sleepDays.date, set: { minutes, syncedAt } });
}

/// Stored sleep minutes for a day, or null if nothing has been synced yet.
/// (null, not 0 — a missing night is "no data", which must not be paired as
/// zero sleep in the Body↔Mind insight.)
export async function getSleepForDay(
  db: AnyDb,
  date: Date = new Date(),
): Promise<number | null> {
  const rows = await db
    .select()
    .from(sleepDays)
    .where(eq(sleepDays.date, dayKey(date)));
  return rows.length > 0 ? Number(rows[0].minutes) : null;
}

/// Reads the day's sleep from the health service and stores it. Returns the
/// stored minutes — unchanged (the previously stored value, or null) if the
/// service has nothing to report.
export async function syncDaySleep(
  db: AnyDb,
  service: HealthService,
  date: Date = new Date(),
): Promise<number | null> {
  const reported = await service.sleepForDay(date);
  if (reported != null) {
    await upsertSleep(db, date, reported);
    return reported;
  }
  return getSleepForDay(db, date);
}
