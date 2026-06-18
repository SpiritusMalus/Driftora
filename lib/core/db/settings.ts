import { count, desc, eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { appSettings, wins, type AppSettings, type Win } from './schema';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests). Query builders are awaitable for both.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// Returns the single settings row, creating it with sensible defaults the
/// first time (honest 7,000-step goal, calories shown, no LLM diary assist).
export async function ensureSettings(db: AnyDb): Promise<AppSettings> {
  const existing = await db.select().from(appSettings).where(eq(appSettings.id, 0));
  if (existing.length > 0) return existing[0] as AppSettings;
  await db.insert(appSettings).values({ id: 0 }).onConflictDoNothing();
  const created = await db.select().from(appSettings).where(eq(appSettings.id, 0));
  return created[0] as AppSettings;
}

/// Fields the settings screen can change. `reminderTimes` is a list of "HH:mm"
/// strings (persisted as JSON).
export interface SettingsPatch {
  targetKcal?: number;
  targetProteinG?: number;
  targetFatG?: number;
  targetCarbG?: number;
  stepsGoal?: number;
  reminderTimes?: string[];
  hideCalories?: boolean;
  llmDiaryAssist?: boolean;
  paused?: boolean;
  showPopulationStats?: boolean;
  region?: 'auto' | 'RU' | 'US';
}

/// Applies a partial update to the single settings row, returning the result.
export async function updateSettings(
  db: AnyDb,
  patch: SettingsPatch,
): Promise<AppSettings> {
  await ensureSettings(db);
  const set: Partial<typeof appSettings.$inferInsert> = {};
  if (patch.targetKcal != null) set.targetKcal = patch.targetKcal;
  if (patch.targetProteinG != null) set.targetProteinG = patch.targetProteinG;
  if (patch.targetFatG != null) set.targetFatG = patch.targetFatG;
  if (patch.targetCarbG != null) set.targetCarbG = patch.targetCarbG;
  if (patch.stepsGoal != null) set.stepsGoal = patch.stepsGoal;
  if (patch.reminderTimes != null) set.reminderTimes = JSON.stringify(patch.reminderTimes);
  if (patch.hideCalories != null) set.hideCalories = patch.hideCalories;
  if (patch.llmDiaryAssist != null) set.llmDiaryAssist = patch.llmDiaryAssist;
  if (patch.paused != null) set.paused = patch.paused;
  if (patch.showPopulationStats != null) set.showPopulationStats = patch.showPopulationStats;
  if (patch.region != null) set.region = patch.region;
  if (Object.keys(set).length > 0) {
    await db.update(appSettings).set(set).where(eq(appSettings.id, 0));
  }
  const rows = await db.select().from(appSettings).where(eq(appSettings.id, 0));
  return rows[0] as AppSettings;
}

/// Parses the stored `reminderTimes` JSON into an "HH:mm" list, tolerant of bad data.
export function parseReminderTimes(json: string): string[] {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/// Logs a celebrated win.
export async function addWin(
  db: AnyDb,
  kind: string,
  message: string,
  ts: Date = new Date(),
): Promise<void> {
  await db.insert(wins).values({ kind, message, ts });
}

/// All wins, newest first.
export async function listWins(db: AnyDb): Promise<Win[]> {
  const rows = await db.select().from(wins).orderBy(desc(wins.ts));
  return rows as Win[];
}

/// How many wins have been logged.
export async function countWins(db: AnyDb): Promise<number> {
  const rows = await db.select({ c: count() }).from(wins);
  return Number(rows[0]?.c ?? 0);
}
