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
  confirmed INTEGER NOT NULL DEFAULT 0,
  micros TEXT
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
CREATE TABLE IF NOT EXISTS food_choices (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  per100 TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS steps_days (
  date TEXT PRIMARY KEY,
  steps INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'stub',
  synced_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sleep_days (
  date TEXT PRIMARY KEY,
  minutes INTEGER NOT NULL DEFAULT 0,
  synced_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  kcal REAL NOT NULL DEFAULT 0,
  speed_kmh REAL,
  label TEXT,
  sets INTEGER
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
  mood_before INTEGER,
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
  height_cm REAL NOT NULL DEFAULT 0,
  sex TEXT NOT NULL DEFAULT '',
  birth_year INTEGER NOT NULL DEFAULT 0,
  activity_level TEXT NOT NULL DEFAULT '',
  goal_mode TEXT NOT NULL DEFAULT 'maintain',
  goal_weight_kg REAL NOT NULL DEFAULT 0,
  deficit_tempo TEXT NOT NULL DEFAULT 'standard',
  body_fat_pct REAL NOT NULL DEFAULT 0,
  targets_set_at INTEGER,
  reminder_times TEXT NOT NULL DEFAULT '[]',
  hide_calories INTEGER NOT NULL DEFAULT 0,
  llm_diary_assist INTEGER NOT NULL DEFAULT 0,
  onboarding_seen INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 0,
  contextual_nudges INTEGER NOT NULL DEFAULT 0,
  show_population_stats INTEGER NOT NULL DEFAULT 0,
  region TEXT NOT NULL DEFAULT 'auto',
  legal_accepted_version TEXT NOT NULL DEFAULT '',
  legal_accepted_at INTEGER,
  ai_food_parse_consent INTEGER NOT NULL DEFAULT 0,
  ai_food_parse_consent_at INTEGER,
  ai_food_parse_consent_version TEXT NOT NULL DEFAULT '',
  sync_enabled INTEGER NOT NULL DEFAULT 0,
  sync_consent_at INTEGER,
  sync_consent_version TEXT NOT NULL DEFAULT ''
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
  // 2026-06-19: РКН-safe AI consent (TASK-2026-06-19-rkn-ai-consent). Two
  // SEPARATE consents — general app Terms/Privacy, and the opt-in cross-border
  // food→AI transfer — plus their captured-fact timestamps/versions.
  `ALTER TABLE app_settings ADD COLUMN legal_accepted_version TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE app_settings ADD COLUMN legal_accepted_at INTEGER`,
  `ALTER TABLE app_settings ADD COLUMN ai_food_parse_consent INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE app_settings ADD COLUMN ai_food_parse_consent_at INTEGER`,
  `ALTER TABLE app_settings ADD COLUMN ai_food_parse_consent_version TEXT NOT NULL DEFAULT ''`,
  // 2026-06-19: opt-in consent to server-backed E2E sync (TASK-2026-06-19 Phase 3).
  // Ships off; the sync client refuses to transfer data until enabled.
  `ALTER TABLE app_settings ADD COLUMN sync_enabled INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE app_settings ADD COLUMN sync_consent_at INTEGER`,
  `ALTER TABLE app_settings ADD COLUMN sync_consent_version TEXT NOT NULL DEFAULT ''`,
  // 2026-06-23: first-run onboarding shown-once flag (TASK-2026-06-23 onboarding).
  // (The new `sleep_days` table needs no ALTER — CREATE TABLE IF NOT EXISTS above
  // covers both fresh and existing installs.)
  `ALTER TABLE app_settings ADD COLUMN onboarding_seen INTEGER NOT NULL DEFAULT 0`,
  // 2026-06-24: opt-in gentle context (JITAI) nudges (TASK-2026-06-23-jitai-reminders).
  // Ships off; local notifications only, conservatively capped.
  `ALTER TABLE app_settings ADD COLUMN contextual_nudges INTEGER NOT NULL DEFAULT 0`,
  // 2026-06-25: steps provenance (TASK-2026-06-24-steps-sources). Existing rows
  // were all stub fills, so they default to 'stub'; manual entries and real
  // device reads tag themselves. Lets the passive sync skip manual days.
  `ALTER TABLE steps_days ADD COLUMN source TEXT NOT NULL DEFAULT 'stub'`,
  // 2026-06-25: mood BEFORE the diary thought record (user feedback) — pairs with
  // the existing `mood` (after) to show the shift across one СМЭР record.
  `ALTER TABLE diary_entries ADD COLUMN mood_before INTEGER`,
  // 2026-07-03: optional body profile for BMI + the Mifflin–St Jeor КБЖУ
  // estimate on the weight screen. Local-only, zero/empty = not provided.
  `ALTER TABLE app_settings ADD COLUMN height_cm REAL NOT NULL DEFAULT 0`,
  `ALTER TABLE app_settings ADD COLUMN sex TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE app_settings ADD COLUMN birth_year INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE app_settings ADD COLUMN activity_level TEXT NOT NULL DEFAULT ''`,
  // 2026-07-03: goal for the weight screen's nutrition-plan card (lose /
  // maintain / gain). Defaults to the no-pressure option: maintain.
  `ALTER TABLE app_settings ADD COLUMN goal_mode TEXT NOT NULL DEFAULT 'maintain'`,
  // 2026-07-04: when the user last DELIBERATELY set КБЖУ targets. Null keeps
  // the day-progress UI hidden — untouched defaults are not a goal.
  `ALTER TABLE app_settings ADD COLUMN targets_set_at INTEGER`,
  // 2026-07-06: goal weight for the plan card — the protein basis in a deficit
  // (жировой массе белок почти не нужен) + the honest "до цели ≈ N" ETA line.
  // 0 = not set (plan falls back to adjusted/current-weight protein basis).
  `ALTER TABLE app_settings ADD COLUMN goal_weight_kg REAL NOT NULL DEFAULT 0`,
  // 2026-07-07: per-entry micronutrient totals (JSON {minerals, vitamins}) for
  // the daily micro roll-up. Nullable — old entries and micro-less foods have none.
  `ALTER TABLE food_entries ADD COLUMN micros TEXT`,
  // 2026-07-08: optional workout pace (km/h) for walk/run/cycle. Null = the user
  // didn't enter a speed, so the fixed moderate MET was used (kcal already frozen).
  `ALTER TABLE workouts ADD COLUMN speed_kmh REAL`,
  // 2026-07-08: optional MEASURED body-fat % → composition-aware BMR (Katch–
  // McArdle) on the weight screen. 0 = not set, plan stays on Mifflin.
  `ALTER TABLE app_settings ADD COLUMN body_fat_pct REAL NOT NULL DEFAULT 0`,
  // 2026-07-08: free-text label for a workout logged via the LLM parse path
  // (e.g. "отжимания"). Null for chip entries. Additive, nullable.
  `ALTER TABLE workouts ADD COLUMN label TEXT`,
  // 2026-07-09: user-chosen deficit tempo for the weight-loss plan (soft −10% /
  // standard −15/−20% / fast −25%). Ships 'standard' = the prior BMI-aware
  // default, so existing installs see no change until the user picks another.
  `ALTER TABLE app_settings ADD COLUMN deficit_tempo TEXT NOT NULL DEFAULT 'standard'`,
  // 2026-07-09: set count for strength workouts logged «подходами» (minutes
  // then hold the ~3-min-per-set estimate). Null for time-based entries.
  `ALTER TABLE workouts ADD COLUMN sets INTEGER`,
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
