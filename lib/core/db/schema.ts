import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/// One logged meal/snack with its parsed macro totals.
export const foodEntries = sqliteTable('food_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: integer('ts', { mode: 'timestamp' }).notNull(),
  rawText: text('raw_text').notNull(),
  source: text('source', { enum: ['voice', 'text', 'photo'] }).notNull(),
  kcal: real('kcal').notNull().default(0),
  proteinG: real('protein_g').notNull().default(0),
  fatG: real('fat_g').notNull().default(0),
  carbG: real('carb_g').notNull().default(0),
  confirmed: integer('confirmed', { mode: 'boolean' }).notNull().default(false),
  // JSON-encoded scaled micronutrient totals for this entry — `{minerals,
  // vitamins}` (each an optional subset). Nullable: pre-migration entries and
  // entries whose foods carried no micro data have none. Powers the daily
  // micro roll-up (todayMicroTotals) without touching per-item rows.
  micros: text('micros'),
  // The USER-CHOSEN meal of day (chips on the log/edit screens). Nullable: old
  // entries and paths with no picker (one-tap «Повторить») store none and the
  // day view falls back to the keyword/clock heuristic in insights/mealType.
  meal: text('meal', { enum: ['breakfast', 'lunch', 'snack', 'dinner'] }),
});

/// The LLM breakdown of a food entry into individual items.
export const foodItems = sqliteTable('food_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  entryId: integer('entry_id')
    .notNull()
    .references(() => foodEntries.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  qtyG: real('qty_g'),
  kcal: real('kcal').notNull().default(0),
  proteinG: real('protein_g').notNull().default(0),
  fatG: real('fat_g').notNull().default(0),
  carbG: real('carb_g').notNull().default(0),
});

/// A per-food match the user explicitly chose (disambiguation layer 2). Keyed by
/// `${region}::${normalized name}`; the stored per-100g is re-applied to future
/// logs of the same food so a correction sticks. `per100` is a JSON-encoded
/// Per100 (kept as text — no dependency on the driver's JSON mode).
export const foodChoices = sqliteTable('food_choices', {
  key: text('key').primaryKey(),
  name: text('name').notNull(), // display name of the chosen match
  per100: text('per100').notNull(), // JSON.stringify(Per100)
  ts: integer('ts', { mode: 'timestamp' }).notNull(),
});

/// Daily step count pulled from the OS health store (one row per day).
export const stepsDays = sqliteTable('steps_days', {
  date: text('date').primaryKey(), // 'YYYY-MM-DD'
  steps: integer('steps').notNull().default(0),
  // Provenance, so the passive OS sync never silently overwrites a number the
  // user typed: 'manual' = entered by hand (sticky), 'device' = read from the
  // OS health store, 'stub' = offline deterministic fill (dev/Expo Go only,
  // never production).
  source: text('source', { enum: ['manual', 'device', 'stub'] })
    .notNull()
    .default('stub'),
  // Steps inside the day's device-imported workout sessions (the MERGED union
  // of their windows, clipped to the day) — computed at sync time. The eating
  // budget subtracts this from `steps` before pricing them, because that
  // movement is already credited as workout kcal; everything else (step goal,
  // wins, insights) keeps the RAW count.
  workoutSteps: integer('workout_steps').notNull().default(0),
  syncedAt: integer('synced_at', { mode: 'timestamp' }).notNull(),
});

/// One logged workout for a day — type + minutes → kcal (MET × weight × hours,
/// computed at log time from the then-current weight). Feeds the daily active-
/// energy add-on (eat-back, 75%) and the plan's with/without-workouts scenarios.
export const workouts = sqliteTable('workouts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: integer('ts', { mode: 'timestamp' }).notNull(),
  date: text('date').notNull(), // 'YYYY-MM-DD' for per-day grouping
  type: text('type').notNull(), // WorkoutType key — MET table lives in bodyMetrics
  minutes: integer('minutes').notNull(),
  kcal: real('kcal').notNull().default(0),
  speedKmh: real('speed_kmh'), // optional pace for walk/run/cycle; null = fixed MET used
  // Free-text label from the LLM parse path (e.g. "отжимания") so the log shows
  // what was actually done; null for chip-logged entries (the type IS the label).
  label: text('label'),
  // Set count for strength entries logged «подходами» (no stopwatch needed);
  // minutes then hold the ~3-min-per-set estimate. Null for time-based entries.
  sets: integer('sets'),
  // Effort level for strength ('light'|'moderate'|'heavy') → the MET used at log
  // time. Null for non-strength and for parsed/tracker entries (fixed MET / a
  // measured number). See [StrengthIntensity] in bodyMetrics.
  intensity: text('intensity'),
  // How the row was logged: chip form / AI free-text parse / «по трекеру»
  // verbatim kcal / auto-imported device session. Old rows default 'manual'
  // (all were user-initiated). Device rows carry the import fields below.
  source: text('source', { enum: ['manual', 'ai', 'tracker', 'device'] })
    .notNull()
    .default('manual'),
  // The OS store's record id (HealthKit UUID / Health Connect metadata.id) —
  // the re-sync dedup key for device imports. Null for user-logged rows.
  externalId: text('external_id'),
  // The session's real time window (device imports only) — start drives `date`,
  // and the window is what the day's step subtraction is computed from.
  startTs: integer('start_ts', { mode: 'timestamp' }),
  endTs: integer('end_ts', { mode: 'timestamp' }),
  // Steps the OS counted INSIDE this session's window — display only («N шагов
  // внутри»). The budget subtracts steps_days.workout_steps (the day's MERGED
  // union), never a sum of these: overlapping sessions would double-subtract.
  stepsInWindow: integer('steps_in_window'),
  // Where a device row's kcal came from: 'device' = the OS store's measured
  // energy (shown verbatim), 'met' = our MET fallback (shown with «≈»). Null
  // for user-logged rows (their display rules predate this column).
  kcalFrom: text('kcal_from', { enum: ['device', 'met'] }),
});
export type WorkoutRow = typeof workouts.$inferSelect;

/// Device sessions the user DELETED from the log. Consulted by the workout
/// import so a re-sync never resurrects them. A separate table (not a flag on
/// `workouts`) keeps every existing SELECT's semantics untouched.
export const workoutImportTombstones = sqliteTable('workout_import_tombstones', {
  externalId: text('external_id').primaryKey(),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }).notNull(),
});

/// Informational body/night signals from the OS health store, one row per day —
/// resting heart rate, night HRV, SpO₂, respiratory rate, VO₂max. Every metric
/// independently nullable (watches vary wildly in what they measure). DISPLAY
/// ONLY: none of these feed the calorie budget. `hrvMethod` matters: iOS
/// exposes SDNN (seconds→ms), Android RMSSD (ms) — different metrics that must
/// never be shown as the same number without their name.
export const healthDays = sqliteTable('health_days', {
  date: text('date').primaryKey(), // 'YYYY-MM-DD'
  restingBpm: integer('resting_bpm'),
  hrvMs: real('hrv_ms'),
  hrvMethod: text('hrv_method', { enum: ['sdnn', 'rmssd'] }),
  spo2Pct: real('spo2_pct'), // 0–100
  respRate: real('resp_rate'), // breaths/min
  vo2max: real('vo2max'), // ml/kg/min, latest within 60 days
  syncedAt: integer('synced_at', { mode: 'timestamp' }).notNull(),
});
export type HealthDayRow = typeof healthDays.$inferSelect;

/// Nightly sleep duration (minutes) pulled from the OS health store, one row per
/// day. A second zero-effort passive signal alongside steps; it feeds the
/// Body↔Mind insight (sleep↔mood). Real HealthKit / Health Connect data is
/// device-gated exactly like steps — an offline stub fills it until then.
export const sleepDays = sqliteTable('sleep_days', {
  date: text('date').primaryKey(), // 'YYYY-MM-DD'
  minutes: integer('minutes').notNull().default(0),
  syncedAt: integer('synced_at', { mode: 'timestamp' }).notNull(),
});

/// Logged body weight, one row per day. No weigh-in pressure: logging is
/// optional and the UI frames the trend neutrally (weight fluctuates).
/// Feeds future adaptive macro targets (recalibrated from the weight trend).
export const weights = sqliteTable('weights', {
  date: text('date').primaryKey(), // 'YYYY-MM-DD'
  weightKg: real('weight_kg').notNull(),
  ts: integer('ts', { mode: 'timestamp' }).notNull(),
  // Provenance, mirroring steps_days.source: 'manual' = typed by the user
  // (sticky — the passive device sync never overwrites it), 'device' = read
  // from the OS health store (smart scale via HealthKit / Health Connect).
  source: text('source', { enum: ['manual', 'device'] }).notNull().default('manual'),
  // Body-fat % measured by the scale ALONGSIDE this weigh-in (0–100). Null for
  // manual rows and scales without impedance. Display/history only — it NEVER
  // feeds BMR silently; the user applies it to app_settings.bodyFatPct with an
  // explicit tap on the weight screen (no smart magic).
  bodyFatPct: real('body_fat_pct'),
});

/// A standalone quick mood check-in (0–10), separate from the full СМЭР diary —
/// low-friction (one tap) so it can feed the Body↔Mind insight daily.
export const moods = sqliteTable('moods', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: integer('ts', { mode: 'timestamp' }).notNull(),
  value: integer('value').notNull(), // 0–10
});

/// A СМЭР (CBT) thought record. `emotions` is a JSON array of
/// `{ name: string, intensity: 0..100 }`.
export const diaryEntries = sqliteTable('diary_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: integer('ts', { mode: 'timestamp' }).notNull(),
  situation: text('situation').notNull().default(''),
  thoughts: text('thoughts').notNull().default(''),
  emotions: text('emotions').notNull().default('[]'),
  reactionBody: text('reaction_body').notNull().default(''),
  reactionBehavior: text('reaction_behavior').notNull().default(''),
  evidenceFor: text('evidence_for').notNull().default(''),
  evidenceAgainst: text('evidence_against').notNull().default(''),
  reframe: text('reframe').notNull().default(''),
  // Mood BEFORE the thought record (0..10, nullable) — captured at the very start,
  // so a record shows the shift across the СМЭР work next to `mood` (after).
  moodBefore: integer('mood_before'),
  mood: integer('mood'), // 0..10, nullable — mood AFTER the thought record
  // JSON array of cognitive-distortion keys (see insights/distortions.ts).
  distortions: text('distortions').notNull().default('[]'),
});

/// A celebrated success / achievement.
export const wins = sqliteTable('wins', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: integer('ts', { mode: 'timestamp' }).notNull(),
  kind: text('kind').notNull(),
  message: text('message').notNull(),
});

/// Single-row app settings (always id = 0). `reminderTimes` is a JSON array of
/// "HH:mm" strings.
export const appSettings = sqliteTable('app_settings', {
  id: integer('id').primaryKey().default(0),
  targetKcal: real('target_kcal').notNull().default(2000),
  targetProteinG: real('target_protein_g').notNull().default(120),
  targetFatG: real('target_fat_g').notNull().default(70),
  targetCarbG: real('target_carb_g').notNull().default(200),
  // Personal, achievable goal — deliberately NOT the "10,000 steps" myth.
  stepsGoal: integer('steps_goal').notNull().default(7000),
  // Body profile for BMI + the Mifflin–St Jeor КБЖУ estimate (weight screen).
  // Zero / empty string mean "not provided" — all four are optional and local.
  heightCm: real('height_cm').notNull().default(0),
  sex: text('sex', { enum: ['', 'male', 'female'] }).notNull().default(''),
  birthYear: integer('birth_year').notNull().default(0),
  activityLevel: text('activity_level', { enum: ['', 'sedentary', 'light', 'moderate', 'high'] })
    .notNull()
    .default(''),
  // Goal for the nutrition-plan card on the weight screen (похудение /
  // поддержание / набор). Defaults to the no-pressure option: maintain.
  goalMode: text('goal_mode', { enum: ['lose', 'maintain', 'gain'] }).notNull().default('maintain'),
  // Goal weight (kg) for the plan card: protein basis in a deficit + the
  // honest "до цели ≈ N мес." ETA. 0 = not set (the plan falls back to the
  // adjusted/current-weight protein basis).
  goalWeightKg: real('goal_weight_kg').notNull().default(0),
  // How aggressive the weight-loss deficit is (the pace lever, lose mode only):
  // 'soft' −10%, 'standard' the BMI-aware −15/−20% default, 'fast' −25%. Ships
  // 'standard' so an untouched setting reproduces the pre-choice plan exactly.
  deficitTempo: text('deficit_tempo', { enum: ['soft', 'standard', 'fast'] })
    .notNull()
    .default('standard'),
  // Optional MEASURED body-fat %. 0 = not set. A plausible value (3–70) switches
  // the plan's BMR to composition-aware Katch–McArdle so muscle vs fat at the
  // same weight diverges; otherwise Mifflin. Local-only, never synced.
  bodyFatPct: real('body_fat_pct').notNull().default(0),
  // Epoch ms of the last DELIBERATE targets change (plan applied / manual edit).
  // Null = the 2000/120/70/200 defaults were never touched — progress UI must
  // stay hidden then, or it would pressure the user with an arbitrary number.
  targetsSetAt: integer('targets_set_at'),
  // Nutrition region for the food parser: 'auto' follows device locale, else
  // forces RU/US (resolveRegion: appSettings.region ?? deviceLocale.region).
  region: text('region', { enum: ['auto', 'RU', 'US'] }).notNull().default('auto'),
  reminderTimes: text('reminder_times').notNull().default('[]'),
  hideCalories: integer('hide_calories', { mode: 'boolean' }).notNull().default(false),
  llmDiaryAssist: integer('llm_diary_assist', { mode: 'boolean' }).notNull().default(false),
  // First-run onboarding shown-once flag. Set true after the calm intro
  // (Body↔Mind + privacy + how to feed the card) is dismissed; returning users
  // never see it again. Additive UX flag, no consent meaning.
  onboardingSeen: integer('onboarding_seen', { mode: 'boolean' }).notNull().default(false),
  // Shown-once interactive coach for the «mind lives behind a left swipe»
  // gesture (the Home mood row was removed 2026-07-12). True once the user
  // performed the swipe in the coach — or explicitly postponed it.
  moodSwipeCoachSeen: integer('mood_swipe_coach_seen', { mode: 'boolean' }).notNull().default(false),
  // DEPRECATED (2026-07-18): drove the retiring Home swipe hint, now replaced
  // by a persistent page-dots indicator. No longer read or written; kept as a
  // column to avoid a migration. Safe to drop in a future schema bump.
  moodSwipeOpens: integer('mood_swipe_opens').notNull().default(0),
  // "Take a break" — mutes auto-wins and target pressure without losing data.
  paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
  // Opt-in (default off): gentle context (JITAI) nudges — e.g. "behind your
  // usual pace this afternoon, fancy a short walk?". Rules are pure + on-device
  // (lib/core/insights/nudgeRules.ts); delivery is local notifications only,
  // nothing leaves the phone. Off by default and conservatively capped
  // (anti-fatigue, Roadmap §5); `paused` mutes it like every other nudge.
  contextualNudges: integer('contextual_nudges', { mode: 'boolean' })
    .notNull()
    .default(false),
  // Opt-in (default off): show sourced step reference points vs. the user's
  // average. Off by default — social comparison can demotivate (Roadmap §5).
  showPopulationStats: integer('show_population_stats', { mode: 'boolean' })
    .notNull()
    .default(false),
  // Opt-in (default off): EXTENDED device import beyond steps+sleep — weight и
  // %жира с умных весов, тренировки с часов, ночные сигналы. Gates every
  // extended read AND the extended OS permission request, so existing users
  // never see a surprise permission sheet (iOS lazily re-requests the base
  // scope on reads — enlarging that list without this gate would prompt
  // everyone on next app open). Off = behavior identical to before.
  healthImportExtended: integer('health_import_extended', { mode: 'boolean' })
    .notNull()
    .default(false),
  // GENERAL consent to use the app (Terms + Privacy Policy), captured by the
  // first-launch offer gate. Stored as the accepted text version + epoch ms;
  // an empty version means "not yet accepted". Kept SEPARATE from the AI
  // cross-border consent below — Russian 152-ФЗ bans bundled consent.
  legalAcceptedVersion: text('legal_accepted_version').notNull().default(''),
  legalAcceptedAt: integer('legal_accepted_at'),
  // SPECIFIC, opt-in consent to the cross-border food→AI transfer (OpenRouter,
  // US). Ships FALSE: the online parser is unreachable until this is
  // true (see foodParserProvider.getFoodParser). The `…At`/`…Version` record
  // the fact of consent for the 152-ФЗ audit trail.
  aiFoodParseConsent: integer('ai_food_parse_consent', { mode: 'boolean' })
    .notNull()
    .default(false),
  aiFoodParseConsentAt: integer('ai_food_parse_consent_at'),
  aiFoodParseConsentVersion: text('ai_food_parse_consent_version').notNull().default(''),
  // SPECIFIC, opt-in consent to server-backed E2E sync (Phase 3). Ships FALSE:
  // the sync client refuses to push/pull until this is true (see
  // lib/core/sync/syncClient.ts). Data is end-to-end encrypted before upload and
  // the server cannot read it, but sync is still a network transfer of (encrypted)
  // health data to OUR server, so it is gated by its own explicit consent —
  // SEPARATE from the AI consent above (152-ФЗ bans bundled consent). The
  // `…At`/`…Version` record the consent fact for the audit trail.
  syncEnabled: integer('sync_enabled', { mode: 'boolean' }).notNull().default(false),
  syncConsentAt: integer('sync_consent_at'),
  syncConsentVersion: text('sync_consent_version').notNull().default(''),
});

export type AppSettings = typeof appSettings.$inferSelect;
export type Win = typeof wins.$inferSelect;
export type FoodEntry = typeof foodEntries.$inferSelect;
export type FoodItem = typeof foodItems.$inferSelect;
export type DiaryEntry = typeof diaryEntries.$inferSelect;
export type WeightRow = typeof weights.$inferSelect;
export type MoodRow = typeof moods.$inferSelect;
export type SleepRow = typeof sleepDays.$inferSelect;
export type StepsRow = typeof stepsDays.$inferSelect;
