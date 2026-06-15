import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { addWin, ensureSettings, listWins } from '@/lib/core/db/settings';

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

describe('database (schema + settings)', () => {
  it('ensureSettings creates one row with an honest (non-10k) step goal', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    const settings = await ensureSettings(db);
    expect(settings.id).toBe(0);
    expect(settings.stepsGoal).toBe(7000);
    expect(settings.hideCalories).toBe(false);
    expect(settings.llmDiaryAssist).toBe(false);

    sqlite.close();
  });

  it('ensureSettings is idempotent', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    await ensureSettings(db);
    await ensureSettings(db);
    const rows = await db.select().from(schema.appSettings);
    expect(rows).toHaveLength(1);

    sqlite.close();
  });

  it('wins can be added and listed newest-first', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    await addWin(db, 'manual', 'older', new Date(2026, 0, 1));
    await addWin(db, 'manual', 'newer', new Date(2026, 1, 1));
    const wins = await listWins(db);
    expect(wins.map((w) => w.message)).toEqual(['newer', 'older']);

    sqlite.close();
  });
});
