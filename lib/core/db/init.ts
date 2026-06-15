/// Idempotent DDL for the M0 schema. Kept in sync with `schema.ts` by hand for
/// now; proper drizzle-kit migrations are introduced when the schema evolves.
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
  mood INTEGER
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
  llm_diary_assist INTEGER NOT NULL DEFAULT 0
);
`;

/// Runs each CREATE statement through [run]. [run] may be sync (better-sqlite3
/// in tests) or async (op-sqlite on device).
export async function applySchema(
  run: (statement: string) => unknown | Promise<unknown>,
): Promise<void> {
  const statements = INIT_SQL.split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    await run(statement);
  }
}
