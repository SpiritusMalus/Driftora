import { desc, eq } from 'drizzle-orm';
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
