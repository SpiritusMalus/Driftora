import { desc, eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type { HealthService } from '../services/health';
import { stepsDays, type StepsRow } from './schema';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests). Query builders are awaitable for both.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// Where a day's step count came from. 'manual' is sticky — the passive OS sync
/// never overwrites it (see [syncDaySteps]); 'device' = OS health store;
/// 'stub' = offline dev fill.
export type StepsSource = 'manual' | 'device' | 'stub';

/// 'YYYY-MM-DD' key for a local calendar day — matches the `steps_days` PK.
export function dayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/// Inserts or updates the step count for a day (one row per 'YYYY-MM-DD'),
/// tagging where the count came from. Defaults to 'device' for back-compat with
/// callers that just store a passive reading.
export async function upsertSteps(
  db: AnyDb,
  day: Date | string,
  steps: number,
  source: StepsSource = 'device',
  syncedAt: Date = new Date(),
): Promise<void> {
  const date = typeof day === 'string' ? day : dayKey(day);
  await db
    .insert(stepsDays)
    .values({ date, steps, source, syncedAt })
    .onConflictDoUpdate({ target: stepsDays.date, set: { steps, source, syncedAt } });
}

/// Records a user-typed step count for a day. Tagged 'manual' so the passive OS
/// sync never silently overwrites it.
export async function setManualSteps(
  db: AnyDb,
  day: Date | string,
  steps: number,
  syncedAt: Date = new Date(),
): Promise<void> {
  await upsertSteps(db, day, steps, 'manual', syncedAt);
}

/// The stored row for a day, or null if nothing has been recorded yet.
export async function getStepsRow(
  db: AnyDb,
  date: Date | string = new Date(),
): Promise<StepsRow | null> {
  const key = typeof date === 'string' ? date : dayKey(date);
  const rows = (await db
    .select()
    .from(stepsDays)
    .where(eq(stepsDays.date, key))) as StepsRow[];
  return rows.length > 0 ? rows[0] : null;
}

/// Stored step count for a day, or 0 if nothing has been recorded yet.
export async function getStepsForDay(
  db: AnyDb,
  date: Date = new Date(),
): Promise<number> {
  const row = await getStepsRow(db, date);
  return row ? Number(row.steps) : 0;
}

/// Recent days newest-first, optionally capped to [limit]. Powers the manual
/// entry screen's editable history.
export async function listStepsDays(db: AnyDb, limit?: number): Promise<StepsRow[]> {
  const query = db.select().from(stepsDays).orderBy(desc(stepsDays.date));
  return (await (limit != null ? query.limit(limit) : query)) as StepsRow[];
}

/// Reads the day's steps from the health service and stores them. Honest about
/// "no data":
///  - a 'manual' day is sticky — returned unchanged, never overwritten;
///  - a real reported count is stored (tagged by the service's provenance);
///  - if the service reports nothing, the previously stored count stands;
///  - with neither a stored value nor a reading, returns null (no fabricated 0).
export async function syncDaySteps(
  db: AnyDb,
  service: HealthService,
  date: Date = new Date(),
): Promise<number | null> {
  const existing = await getStepsRow(db, date);
  if (existing && existing.source === 'manual') {
    return Number(existing.steps); // manual is sticky
  }
  const reported = await service.stepsForDay(date);
  if (reported != null) {
    await upsertSteps(db, date, reported, service.source ?? 'device');
    return reported;
  }
  return existing ? Number(existing.steps) : null;
}
