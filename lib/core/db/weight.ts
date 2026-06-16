import { desc } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { weights, type WeightRow } from './schema';
import { dayKey } from './steps';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests). Query builders are awaitable for both.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// Inserts or updates the weight for a day (one row per 'YYYY-MM-DD'), so a
/// re-weigh on the same day corrects rather than stacks.
export async function upsertWeight(
  db: AnyDb,
  day: Date | string,
  weightKg: number,
  ts: Date = new Date(),
): Promise<void> {
  const date = typeof day === 'string' ? day : dayKey(day);
  await db
    .insert(weights)
    .values({ date, weightKg, ts })
    .onConflictDoUpdate({ target: weights.date, set: { weightKg, ts } });
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

/// Weights newest-first, optionally capped to [limit].
export async function listWeights(db: AnyDb, limit?: number): Promise<WeightRow[]> {
  const query = db.select().from(weights).orderBy(desc(weights.date));
  return (await (limit != null ? query.limit(limit) : query)) as WeightRow[];
}
