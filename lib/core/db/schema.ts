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
  syncedAt: integer('synced_at', { mode: 'timestamp' }).notNull(),
});

/// Nightly sleep duration (minutes) pulled from the OS health store, one row per
/// day. A second zero-effort passive signal alongside steps; it feeds the
/// Body↔Mind insight (sleep↔mood). Real HealthKit / Health Connect data is
/// device-gated exactly like steps — an offline stub fills it until then.
export const sleepDays = sqliteTable('sleep_days', {
  date: text('date').primaryKey(), // 'YYYY-MM-DD'
  minutes: integer('minutes').notNull().default(0),
  syncedAt: integer('synced_at', { mode: 'timestamp' }).notNull(),
});

/// Manually logged body weight, one row per day. No weigh-in pressure: logging
/// is optional and the UI frames the trend neutrally (weight fluctuates).
/// Feeds future adaptive macro targets (recalibrated from the weight trend).
export const weights = sqliteTable('weights', {
  date: text('date').primaryKey(), // 'YYYY-MM-DD'
  weightKg: real('weight_kg').notNull(),
  ts: integer('ts', { mode: 'timestamp' }).notNull(),
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
