import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import {
  countWins,
  ensureSettings,
  parseReminderTimes,
  updateSettings,
} from '@/lib/core/db/settings';

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

describe('updateSettings', () => {
  it('updates targets, steps goal and flags, leaving other fields at defaults', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    const updated = await updateSettings(db, {
      targetKcal: 1800,
      targetProteinG: 140,
      stepsGoal: 8000,
      hideCalories: true,
      paused: true,
    });
    expect(updated.targetKcal).toBe(1800);
    expect(updated.targetProteinG).toBe(140);
    expect(updated.stepsGoal).toBe(8000);
    expect(updated.hideCalories).toBe(true);
    expect(updated.paused).toBe(true);
    expect(updated.targetFatG).toBe(70); // untouched default
    expect(updated.llmDiaryAssist).toBe(false); // untouched default

    sqlite.close();
  });

  it('round-trips reminder times through JSON', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    const updated = await updateSettings(db, { reminderTimes: ['08:00', '21:30'] });
    expect(parseReminderTimes(updated.reminderTimes)).toEqual(['08:00', '21:30']);

    sqlite.close();
  });

  it('an empty patch leaves the row unchanged', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    const before = await ensureSettings(db);
    const after = await updateSettings(db, {});
    expect(after).toEqual(before);

    sqlite.close();
  });
});

describe('parseReminderTimes', () => {
  it('tolerates malformed or non-array JSON', () => {
    expect(parseReminderTimes('nope')).toEqual([]);
    expect(parseReminderTimes('{}')).toEqual([]);
    expect(parseReminderTimes('[]')).toEqual([]);
    expect(parseReminderTimes('["07:15","23:00"]')).toEqual(['07:15', '23:00']);
  });
});

describe('countWins', () => {
  it('counts logged wins', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    expect(await countWins(db)).toBe(0);
    await db.insert(schema.wins).values({ kind: 'manual', message: 'first', ts: new Date() });
    await db.insert(schema.wins).values({ kind: 'manual', message: 'second', ts: new Date() });
    expect(await countWins(db)).toBe(2);

    sqlite.close();
  });
});
