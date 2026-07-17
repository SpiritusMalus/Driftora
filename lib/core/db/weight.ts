import { desc, eq, isNotNull } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type { HealthSample, HealthService } from '../services/health';
import { weights, type WeightRow } from './schema';
import { dayKey } from './steps';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests). Query builders are awaitable for both.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// Provenance of a weigh-in — mirrors StepsSource semantics: 'manual' is
/// sticky (the passive device sync never overwrites a number the user typed).
export type WeightSource = 'manual' | 'device';

/// Inserts or updates the weight for a day (one row per 'YYYY-MM-DD'), so a
/// re-weigh on the same day corrects rather than stacks. A manual save keeps
/// any scale-measured bodyFatPct already stored for that day (correcting the
/// kilos doesn't erase the impedance measurement).
export async function upsertWeight(
  db: AnyDb,
  day: Date | string,
  weightKg: number,
  ts: Date = new Date(),
): Promise<void> {
  const date = typeof day === 'string' ? day : dayKey(day);
  await db
    .insert(weights)
    .values({ date, weightKg, ts, source: 'manual' })
    .onConflictDoUpdate({ target: weights.date, set: { weightKg, ts, source: 'manual' } });
}

/// Device-sourced upsert (smart scale via HealthKit / Health Connect).
/// MANUAL-STICKY: if the day's row was typed by the user it is left untouched —
/// same honesty rule as syncDaySteps. bodyFatPct is 0–100 or null. Returns
/// whether a row was actually written (false = the sticky skip).
export async function upsertDeviceWeight(
  db: AnyDb,
  day: Date | string,
  weightKg: number,
  bodyFatPct: number | null,
  ts: Date = new Date(),
): Promise<boolean> {
  const date = typeof day === 'string' ? day : dayKey(day);
  const existing = await getWeightForDay(db, date);
  if (existing && existing.source === 'manual') return false;
  await db
    .insert(weights)
    .values({ date, weightKg, ts, source: 'device', bodyFatPct })
    .onConflictDoUpdate({
      target: weights.date,
      set: { weightKg, ts, source: 'device', bodyFatPct },
    });
  return true;
}

/// Pure: latest sample per local day — a scale weighed several times a day
/// should store the LAST measurement, not a random one. Exported for tests.
export function lastSamplePerDay(samples: HealthSample[]): Map<string, HealthSample> {
  const byDay = new Map<string, HealthSample>();
  for (const s of samples) {
    const at = new Date(s.at);
    if (!Number.isFinite(at.getTime()) || !Number.isFinite(s.value)) continue;
    const key = dayKey(at);
    const prev = byDay.get(key);
    if (!prev || new Date(prev.at).getTime() < at.getTime()) byDay.set(key, s);
  }
  return byDay;
}

/// Plausibility clamp for a scale reading — garbage (0, negative, 500 kg from a
/// cat on the scale edge) must not enter the trend. Same band suggestPlan uses.
function plausibleKg(v: number): boolean {
  return Number.isFinite(v) && v >= 20 && v <= 400;
}

/// Pulls device weigh-ins (and body-fat, when the scale measured it) for the
/// last [days] local days into the weights table. Manual rows stay untouched.
/// No-op (returns 0) when the service can't read weight — honest degradation.
export async function syncWeighIns(
  db: AnyDb,
  service: HealthService,
  days = 1,
  now: Date = new Date(),
): Promise<number> {
  if (!service.weightSamplesForRange) return 0;
  const end = new Date(now.getTime());
  const start = new Date(now.getTime() - Math.max(0, days - 1) * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);
  const weightSamples = await service.weightSamplesForRange(start, end);
  if (!weightSamples || weightSamples.length === 0) return 0;
  const fatSamples = service.bodyFatSamplesForRange
    ? await service.bodyFatSamplesForRange(start, end)
    : null;
  const fatByDay = lastSamplePerDay(fatSamples ?? []);
  let written = 0;
  for (const [date, sample] of lastSamplePerDay(weightSamples)) {
    if (!plausibleKg(sample.value)) continue;
    const fat = fatByDay.get(date)?.value;
    const bodyFatPct = fat != null && fat > 0 && fat < 100 ? fat : null;
    if (await upsertDeviceWeight(db, date, sample.value, bodyFatPct, new Date(sample.at))) {
      written += 1;
    }
  }
  return written;
}

/// The weigh-in stored for one 'YYYY-MM-DD' day, or null — the day-history view.
export async function getWeightForDay(
  db: AnyDb,
  day: Date | string,
): Promise<WeightRow | null> {
  const date = typeof day === 'string' ? day : dayKey(day);
  const rows = (await db.select().from(weights).where(eq(weights.date, date))) as WeightRow[];
  return rows.length > 0 ? rows[0] : null;
}

/// The most recently dated weight, or null if none logged.
export async function latestWeight(db: AnyDb): Promise<WeightRow | null> {
  const rows = (await db
    .select()
    .from(weights)
    .orderBy(desc(weights.date))
    .limit(1)) as WeightRow[];
  return rows.length > 0 ? rows[0] : null;
}

/// The most recent scale-measured body-fat %, or null. Display + explicit
/// «Использовать в расчёте» only — it never feeds BMR without that tap.
export async function latestDeviceBodyFat(db: AnyDb): Promise<WeightRow | null> {
  const rows = (await db
    .select()
    .from(weights)
    .where(isNotNull(weights.bodyFatPct))
    .orderBy(desc(weights.date))
    .limit(1)) as WeightRow[];
  return rows.length > 0 ? rows[0] : null;
}

/// Weights newest-first, optionally capped to [limit].
export async function listWeights(db: AnyDb, limit?: number): Promise<WeightRow[]> {
  const query = db.select().from(weights).orderBy(desc(weights.date));
  return (await (limit != null ? query.limit(limit) : query)) as WeightRow[];
}
