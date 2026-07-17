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

  it('upgrades a pre-import workouts table: source manual, import fields null, data survives', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    // Old install: workouts without the device-import columns, one logged row.
    sqlite.exec(`CREATE TABLE workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      minutes INTEGER NOT NULL,
      kcal REAL NOT NULL DEFAULT 0,
      speed_kmh REAL,
      label TEXT,
      sets INTEGER,
      intensity TEXT
    );`);
    sqlite.exec(
      "INSERT INTO workouts (ts, date, type, minutes, kcal) VALUES (0, '2026-07-01', 'run', 30, 300)",
    );
    // And steps_days without workout_steps, with a recorded day.
    sqlite.exec(`CREATE TABLE steps_days (
      date TEXT PRIMARY KEY,
      steps INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'stub',
      synced_at INTEGER NOT NULL
    );`);
    sqlite.exec("INSERT INTO steps_days (date, steps, source, synced_at) VALUES ('2026-07-01', 8000, 'device', 0)");

    await applySchema((s) => sqlite.exec(s));

    const db = drizzle(sqlite, { schema });
    const [w] = await db.select().from(schema.workouts);
    expect(w.kcal).toBe(300); // existing data preserved
    expect(w.source).toBe('manual'); // old rows were user-initiated
    expect(w.externalId).toBeNull();
    expect(w.kcalFrom).toBeNull();
    const [sd] = await db.select().from(schema.stepsDays);
    expect(sd.steps).toBe(8000);
    expect(sd.workoutSteps).toBe(0); // new column, nothing subtracted yet
    sqlite.close();
  });

  it('upgrades a pre-device weights table: source defaults to manual, data survives', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    // Old install: weights without source/body_fat_pct, with a logged weigh-in.
    sqlite.exec(`CREATE TABLE weights (
      date TEXT PRIMARY KEY,
      weight_kg REAL NOT NULL,
      ts INTEGER NOT NULL
    );`);
    sqlite.exec("INSERT INTO weights (date, weight_kg, ts) VALUES ('2026-07-01', 82.4, 0)");

    await applySchema((s) => sqlite.exec(s));

    const db = drizzle(sqlite, { schema });
    const rows = await db.select().from(schema.weights);
    expect(rows).toHaveLength(1);
    expect(rows[0].weightKg).toBe(82.4); // existing data preserved
    expect(rows[0].source).toBe('manual'); // old rows were all typed by hand
    expect(rows[0].bodyFatPct).toBeNull();
    // The extended-import flag lands too, shipped OFF.
    expect((await ensureSettings(db)).healthImportExtended).toBe(false);
    sqlite.close();
  });
});
