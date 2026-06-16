import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/// One logged meal/snack with its parsed macro totals.
export const foodEntries = sqliteTable('food_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: integer('ts', { mode: 'timestamp' }).notNull(),
  rawText: text('raw_text').notNull(),
  source: text('source', { enum: ['voice', 'text'] }).notNull(),
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

/// Daily step count pulled from the OS health store (one row per day).
export const stepsDays = sqliteTable('steps_days', {
  date: text('date').primaryKey(), // 'YYYY-MM-DD'
  steps: integer('steps').notNull().default(0),
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
  mood: integer('mood'), // 0..10, nullable
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
  reminderTimes: text('reminder_times').notNull().default('[]'),
  hideCalories: integer('hide_calories', { mode: 'boolean' }).notNull().default(false),
  llmDiaryAssist: integer('llm_diary_assist', { mode: 'boolean' }).notNull().default(false),
  // "Take a break" — mutes auto-wins and target pressure without losing data.
  paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
});

export type AppSettings = typeof appSettings.$inferSelect;
export type Win = typeof wins.$inferSelect;
export type FoodEntry = typeof foodEntries.$inferSelect;
export type DiaryEntry = typeof diaryEntries.$inferSelect;
export type WeightRow = typeof weights.$inferSelect;
