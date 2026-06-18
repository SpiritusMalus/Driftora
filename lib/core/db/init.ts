/// Idempotent DDL for the M0 schema. This is a second source of truth alongside
/// the Drizzle defs in `schema.ts` (Drizzle drives types + queries; this DDL
/// actually creates the tables). The two are hand-synced, but drift is guarded:
/// `__tests__/schemaConsistency.test.ts` builds these tables and asserts they
/// match the Drizzle schema, so a divergence fails in jest instead of crashing
/// on-device. Move to drizzle-kit migrations once the schema first evolves on
/// shipped devices (CREATE TABLE IF NOT EXISTS cannot ALTER an existing table).
export const INIT_SQL = `
CREATE TABLE IF NOT EXISTS food_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  raw_text TEXT NOT NULL,
  source TEXT NOT NULL,
  kcal REAL NOT NULL DEFAULT 0,
  protein_g REAL NOT NULL DEFAULT 0,
  fat_g REAL NOT NULL DEFAULT 0,
  carb_g REAL NOT NULL DEFAULT 0,
  confirmed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS food_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES food_entries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  qty_g REAL,
  kcal REAL NOT NULL DEFAULT 0,
  protein_g REAL NOT NULL DEFAULT 0,
  fat_g REAL NOT NULL DEFAULT 0,
  carb_g REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS steps_days (
  date TEXT PRIMARY KEY,
  steps INTEGER NOT NULL DEFAULT 0,
  synced_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS weights (
  date TEXT PRIMARY KEY,
  weight_kg REAL NOT NULL,
  ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS moods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  value INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS diary_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  situation TEXT NOT NULL DEFAULT '',
  thoughts TEXT NOT NULL DEFAULT '',
  emotions TEXT NOT NULL DEFAULT '[]',
  reaction_body TEXT NOT NULL DEFAULT '',
  reaction_behavior TEXT NOT NULL DEFAULT '',
  evidence_for TEXT NOT NULL DEFAULT '',
  evidence_against TEXT NOT NULL DEFAULT '',
  reframe TEXT NOT NULL DEFAULT '',
  mood INTEGER,
  distortions TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS wins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
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
  show_population_stats INTEGER NOT NULL DEFAULT 0,
  region TEXT NOT NULL DEFAULT 'auto'
);
`;

/// Idempotent ALTERs for schema that evolved AFTER the initial release, since
/// `CREATE TABLE IF NOT EXISTS` can't add a column to an existing table. Each is
/// re-run on every launch and is expected to throw "duplicate column" once the
/// column exists — that error is swallowed (see [applySchema]). This is the
/// lightweight migration path the app actually runs on-device; the drizzle-kit
/// migration in `drizzle/` mirrors it for tooling/history.
export const MIGRATIONS: string[] = [
  // 2026-06-18: region override for the food parser (BUILD-SPEC finalize, part B).
  `ALTER TABLE app_settings ADD COLUMN region TEXT NOT NULL DEFAULT 'auto'`,
];

/// Runs each CREATE statement through [run], then the idempotent [MIGRATIONS].
/// [run] may be sync (better-sqlite3 in tests) or async (op-sqlite on device).
/// A migration that throws because its column already exists is swallowed, so
/// re-running on every launch is safe (and fresh installs already have the
/// column from the CREATE above — that ALTER is the no-op that gets ignored).
export async function applySchema(
  run: (statement: string) => unknown | Promise<unknown>,
): Promise<void> {
  const statements = INIT_SQL.split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    await run(statement);
  }
  for (const migration of MIGRATIONS) {
    try {
      await run(migration);
    } catch {
      // Expected when the column already exists (duplicate column) — idempotent.
    }
  }
}
