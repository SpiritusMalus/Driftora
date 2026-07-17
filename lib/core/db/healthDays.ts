import { eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type { DeviceBodySignals } from '../services/health';
import { healthDays, type HealthDayRow } from './schema';
import { dayKey } from './steps';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests) — mirrors [steps.ts].
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// Stores a day's device body/night signals (one row per 'YYYY-MM-DD').
/// All-null bags are skipped — an empty row would render an empty «Ночь» block.
/// Returns whether a row was written.
export async function upsertHealthDay(
  db: AnyDb,
  day: Date | string,
  signals: DeviceBodySignals,
  syncedAt: Date = new Date(),
): Promise<boolean> {
  const hasAny =
    signals.restingBpm != null ||
    signals.hrvMs != null ||
    signals.spo2Pct != null ||
    signals.respRate != null ||
    signals.vo2Max != null;
  if (!hasAny) return false;
  const date = typeof day === 'string' ? day : dayKey(day);
  const values = {
    date,
    restingBpm: signals.restingBpm != null ? Math.round(signals.restingBpm) : null,
    hrvMs: signals.hrvMs,
    hrvMethod: signals.hrvMs != null ? signals.hrvMethod : null,
    spo2Pct: signals.spo2Pct,
    respRate: signals.respRate,
    vo2max: signals.vo2Max,
    syncedAt,
  };
  await db
    .insert(healthDays)
    .values(values)
    .onConflictDoUpdate({ target: healthDays.date, set: values });
  return true;
}

/// The stored signals for one day, or null.
export async function getHealthDay(
  db: AnyDb,
  day: Date | string = new Date(),
): Promise<HealthDayRow | null> {
  const date = typeof day === 'string' ? day : dayKey(day);
  const rows = (await db
    .select()
    .from(healthDays)
    .where(eq(healthDays.date, date))) as HealthDayRow[];
  return rows.length > 0 ? rows[0] : null;
}
