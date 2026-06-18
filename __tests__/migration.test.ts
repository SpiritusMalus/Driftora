import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { ensureSettings, updateSettings } from '@/lib/core/db/settings';

/// Verifies the idempotent ALTER migrations (lib/core/db/init.ts) bring an
/// EXISTING install (one created before a column was added) up to date — the
/// real on-device upgrade path, since CREATE TABLE IF NOT EXISTS can't ALTER.

const OLD_APP_SETTINGS = `
CREATE TABLE app_settings (
  id INTEGER PRIMARY KEY DEFAULT 0,
  target_kcal REAL NOT NULL DEFAULT 2000,
  target_protein_g REAL NOT NULL DEFAULT 120,
  target_fat_g REAL NOT NULL DEFAULT 70,
  target_carb_g REAL NOT NULL DEFAULT 200,
  steps_goal INTEGER NOT NULL DEFAULT 7000,
  reminder_times TEXT NOT NULL DEFAULT '[]',
  hide_calories INTEGER NOT NULL DEFAULT 0,
  llm_diary_assist INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 0,
  show_population_stats INTEGER NOT NULL DEFAULT 0
);`;

describe('schema migrations (existing install)', () => {
  it('adds app_settings.region to a pre-region database, defaulting to auto', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    // Simulate an old install: app_settings WITHOUT region, with a saved row.
    sqlite.exec(OLD_APP_SETTINGS);
    sqlite.exec('INSERT INTO app_settings (id, hide_calories) VALUES (0, 1)');

    // Upgrade: CREATE IF NOT EXISTS is a no-op for app_settings, the ALTER adds region.
    await applySchema((s) => sqlite.exec(s));

    const db = drizzle(sqlite, { schema });
    const s = await ensureSettings(db);
    expect(s.region).toBe('auto'); // new column, default applied
    expect(s.hideCalories).toBe(true); // existing data preserved

    // And it's writable post-migration.
    expect((await updateSettings(db, { region: 'US' })).region).toBe('US');
    sqlite.close();
  });

  it('is idempotent — applying the schema twice does not throw', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    await applySchema((s) => sqlite.exec(s));
    await applySchema((s) => sqlite.exec(s)); // second run: ALTER hits "duplicate column", swallowed
    const db = drizzle(sqlite, { schema });
    expect((await ensureSettings(db)).region).toBe('auto');
    sqlite.close();
  });
});
