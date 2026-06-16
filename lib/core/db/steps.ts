import { eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type { HealthService } from '../services/health';
import { stepsDays } from './schema';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests). Query builders are awaitable for both.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// 'YYYY-MM-DD' key for a local calendar day — matches the `steps_days` PK.
export function dayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/// Inserts or updates the step count for a day (one row per 'YYYY-MM-DD').
export async function upsertSteps(
  db: AnyDb,
  day: Date | string,
  steps: number,
  syncedAt: Date = new Date(),
): Promise<void> {
  const date = typeof day === 'string' ? day : dayKey(day);
  await db
    .insert(stepsDays)
    .values({ date, steps, syncedAt })
    .onConflictDoUpdate({ target: stepsDays.date, set: { steps, syncedAt } });
}

/// Stored step count for a day, or 0 if nothing has been synced yet.
export async function getStepsForDay(
  db: AnyDb,
  date: Date = new Date(),
): Promise<number> {
  const rows = await db
    .select()
    .from(stepsDays)
    .where(eq(stepsDays.date, dayKey(date)));
  return rows.length > 0 ? Number(rows[0].steps) : 0;
}

/// Reads the day's steps from the health service and stores them. Returns the
/// stored count — unchanged (the previously stored value) if the service has
/// nothing to report.
export async function syncDaySteps(
  db: AnyDb,
  service: HealthService,
  date: Date = new Date(),
): Promise<number> {
  const reported = await service.stepsForDay(date);
  if (reported != null) {
    await upsertSteps(db, date, reported);
    return reported;
  }
  return getStepsForDay(db, date);
}
