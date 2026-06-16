import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { diaryEntries, foodEntries } from './schema';
import { dayKey } from './steps';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests). Query builders are awaitable for both.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// The set of local 'YYYY-MM-DD' days that had at least one **self-initiated**
/// log — a food entry or a diary entry. Passive data (steps, synced from the OS)
/// is deliberately excluded: the north-star and streak reward *showing up*, not
/// the device syncing in the background.
export async function selfInitiatedLogDays(db: AnyDb): Promise<Set<string>> {
  const [food, diary] = await Promise.all([
    db.select({ ts: foodEntries.ts }).from(foodEntries),
    db.select({ ts: diaryEntries.ts }).from(diaryEntries),
  ]);
  const days = new Set<string>();
  for (const row of [...food, ...diary]) days.add(dayKey(row.ts as Date));
  return days;
}
