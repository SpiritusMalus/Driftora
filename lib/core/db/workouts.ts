import { desc, eq, inArray } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import {
  kcalFromMet,
  STRENGTH_INTENSITIES,
  workoutKcal,
  WORKOUT_TYPES,
  type StrengthIntensity,
  type WorkoutType,
} from '../insights/bodyMetrics';
import { workoutImportTombstones, workouts, type WorkoutRow } from './schema';
import { dayKey } from './steps';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests) — mirrors [steps.ts].
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// Log one workout for a day. kcal is computed HERE from the then-current weight
/// (MET × kg × hours, plus the type's EPOC afterburn) and stored, so the number
/// is stable even if the user later re-weighs. An optional pace (km/h, for
/// walk/run/cycle) refines the MET; when omitted the fixed moderate MET is used.
/// `sets` records a strength entry logged «подходами» (minutes then already hold
/// the per-set estimate — see [setsToMinutes]). Returns the inserted row's kcal.
export async function addWorkout(
  db: AnyDb,
  type: WorkoutType,
  minutes: number,
  weightKg: number,
  speedKmh: number | null = null,
  when: Date = new Date(),
  sets: number | null = null,
  intensity: StrengthIntensity | null = null,
): Promise<number> {
  const kcal = workoutKcal(type, minutes, weightKg, speedKmh, intensity);
  await db.insert(workouts).values({
    ts: when,
    date: dayKey(when),
    type,
    minutes: Math.round(Math.max(0, minutes)),
    kcal,
    speedKmh: speedKmh != null && speedKmh > 0 ? speedKmh : null,
    sets: sets != null && sets > 0 ? Math.round(sets) : null,
    // Effort is a strength-only lever; store it only where it shaped the MET.
    intensity: type === 'strength' && intensity != null ? intensity : null,
  });
  return kcal;
}

/// One activity parsed from a free-text description (LLM parse path). `type` is a
/// WorkoutType key or 'other'; `met` is the model's estimate, used ONLY for
/// 'other' (known types use the app's own MET); `sets` comes back for strength
/// when the user named подходы. Mirrors the server `ParsedWorkout`.
export interface ParsedWorkoutInput {
  type: string;
  name_ru: string;
  minutes: number;
  speedKmh?: number | null;
  met?: number | null;
  sets?: number | null;
}

/// Log a workout parsed from free text. kcal is computed HERE (client-side) from
/// the user's weight — a known type uses the app's MET (pace-refined when given),
/// an 'other' activity uses the model's MET. The model's phrasing is kept in
/// `label` so the log shows what was actually done; its minutes stay the duration
/// basis even when sets are present (the model saw the reps detail — a fixed
/// per-set constant would be a worse estimate). Returns the stored kcal.
export async function addParsedWorkout(
  db: AnyDb,
  parsed: ParsedWorkoutInput,
  weightKg: number,
  when: Date = new Date(),
): Promise<number> {
  const known = (WORKOUT_TYPES as readonly string[]).includes(parsed.type);
  const speedKmh = parsed.speedKmh != null && parsed.speedKmh > 0 ? parsed.speedKmh : null;
  const kcal = known
    ? workoutKcal(parsed.type as WorkoutType, parsed.minutes, weightKg, speedKmh)
    : kcalFromMet(parsed.met ?? 0, parsed.minutes, weightKg);
  await db.insert(workouts).values({
    ts: when,
    date: dayKey(when),
    type: parsed.type,
    minutes: Math.round(Math.max(0, parsed.minutes)),
    kcal,
    speedKmh,
    label: parsed.name_ru.trim() || null,
    sets: parsed.sets != null && parsed.sets > 0 ? Math.round(parsed.sets) : null,
    source: 'ai',
  });
  return kcal;
}

/// Log a workout whose burn came from the user's OWN tracker screenshot: the
/// device measured it (heart rate + sensors), so its printed kcal is stored
/// VERBATIM instead of a MET estimate — no EPOC bonus either (a watch total
/// already is the session's measurement). Clamped to a sane band so an OCR
/// misread can't blow up the day. Returns the stored kcal.
export async function addTrackerWorkout(
  db: AnyDb,
  input: { kcal: number; minutes: number; type?: string; label?: string | null; sets?: number | null },
  when: Date = new Date(),
): Promise<number> {
  const kcal = Math.round(Math.min(Math.max(0, input.kcal), 5000));
  await db.insert(workouts).values({
    ts: when,
    date: dayKey(when),
    type: input.type ?? 'other',
    minutes: Math.round(Math.min(Math.max(0, input.minutes), 600)),
    kcal,
    speedKmh: null,
    label: input.label?.trim() || null,
    sets: input.sets != null && input.sets > 0 ? Math.round(input.sets) : null,
    source: 'tracker',
  });
  return kcal;
}

/// One device session normalized for storage — the sync layer resolves the kcal
/// (window aggregate → session total → ≈MET) BEFORE calling this.
export interface DeviceWorkoutInput {
  externalId: string;
  start: Date;
  end: Date;
  type: string; // WorkoutType key or 'other'
  title: string | null;
  minutes: number;
  kcal: number;
  kcalFrom: 'device' | 'met';
  stepsInWindow: number | null;
}

/// Upserts a device-imported session, keyed by the OS record id: a re-sync
/// UPDATES the existing row (watch data often firms up minutes after the
/// session) instead of duplicating it, and a tombstoned id — one the user
/// deleted — is never resurrected. The row's `date` is the session's START
/// day, matching manual `ts → date` semantics for midnight-crossers. Returns
/// whether the session is now present in the log.
export async function importDeviceWorkout(db: AnyDb, input: DeviceWorkoutInput): Promise<boolean> {
  const dead = await db
    .select()
    .from(workoutImportTombstones)
    .where(eq(workoutImportTombstones.externalId, input.externalId));
  if (dead.length > 0) return false;
  const values = {
    ts: input.start,
    date: dayKey(input.start),
    type: input.type,
    minutes: Math.round(Math.min(Math.max(0, input.minutes), 600)),
    kcal: Math.round(Math.min(Math.max(0, input.kcal), 5000)),
    speedKmh: null,
    label: input.title,
    sets: null,
    intensity: null,
    source: 'device' as const,
    externalId: input.externalId,
    startTs: input.start,
    endTs: input.end,
    stepsInWindow:
      input.stepsInWindow != null ? Math.max(0, Math.round(input.stepsInWindow)) : null,
    kcalFrom: input.kcalFrom,
  };
  const existing = (await db
    .select()
    .from(workouts)
    .where(eq(workouts.externalId, input.externalId))) as WorkoutRow[];
  if (existing.length > 0) {
    await db.update(workouts).set(values).where(eq(workouts.id, existing[0].id));
  } else {
    await db.insert(workouts).values(values);
  }
  return true;
}

/// Which of the given OS record ids the user has deleted (tombstoned).
export async function tombstonedIds(db: AnyDb, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = (await db
    .select()
    .from(workoutImportTombstones)
    .where(inArray(workoutImportTombstones.externalId, ids))) as { externalId: string }[];
  return new Set(rows.map((r) => r.externalId));
}

/// A workout the user already logged once, re-loggable in one tap — the same
/// idea as the food log's [QuickMeal], carrying everything the form would have
/// asked for so a repeat is a single insert with no typing and no AI call.
export interface QuickWorkout {
  type: string; // WorkoutType key or 'other'
  label: string | null;
  minutes: number;
  sets: number | null;
  speedKmh: number | null;
  intensity: StrengthIntensity | null;
  /// kcal of the latest occurrence. Reused VERBATIM only for an unknown
  /// ('other') activity — its MET came from the model and was never stored, so
  /// there is nothing to recompute. Known types recompute from today's weight.
  kcal: number;
  source: 'manual' | 'ai';
  /// Times this exact workout appears in the scanned window — drives the order
  /// (what you repeat most is what you reach for first).
  count: number;
}

/// One past row as the quick-repeat ranking sees it.
interface QuickWorkoutSource {
  type: string;
  label: string | null;
  minutes: number;
  sets: number | null;
  speedKmh: number | null;
  intensity: string | null;
  kcal: number;
  source: string;
  ts: Date;
}

/// Derives the one-tap repeat list from past rows: identical workouts collapse
/// into one entry, repeated ones (count ≥ 2) lead — a repeat is what's worth
/// one-tapping — and the rest follow by recency. Pure (grouping/ordering only)
/// so it's unit-testable and independent of row order.
///
/// MEASURED rows are excluded on purpose. A watch session and a tracker
/// screenshot are readings of THAT session, not templates: re-logging one would
/// invent a measurement that never happened (and device rows re-import
/// themselves anyway). Only what the user entered can be entered again.
export function deriveQuickWorkouts(rows: QuickWorkoutSource[], limit = 8): QuickWorkout[] {
  const groups = new Map<string, { quick: QuickWorkout; latestTs: number }>();
  for (const r of rows) {
    if (r.source !== 'manual' && r.source !== 'ai') continue;
    const minutes = Math.round(Math.max(0, r.minutes));
    const sets = r.sets != null && r.sets > 0 ? Math.round(r.sets) : null;
    // Nothing to repeat without a duration or a set count.
    if (minutes <= 0 && sets == null) continue;
    const label = r.label?.trim() || null;
    const speedKmh = r.speedKmh != null && r.speedKmh > 0 ? r.speedKmh : null;
    const intensity =
      r.intensity != null && (STRENGTH_INTENSITIES as readonly string[]).includes(r.intensity)
        ? (r.intensity as StrengthIntensity)
        : null;
    // Everything that shapes the entry is in the key: «ходьба 30 мин» and
    // «ходьба 45 мин» are two different things to tap.
    const key = [r.type, label?.toLowerCase() ?? '', minutes, sets ?? '', speedKmh ?? '', intensity ?? ''].join('|');
    const ts = r.ts.getTime();
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        latestTs: ts,
        quick: {
          type: r.type,
          label,
          minutes,
          sets,
          speedKmh,
          intensity,
          kcal: Math.round(r.kcal),
          source: r.source,
          count: 1,
        },
      });
      continue;
    }
    existing.quick.count += 1;
    // Keep kcal from the most recent occurrence (order-independent).
    if (ts > existing.latestTs) {
      existing.latestTs = ts;
      existing.quick.kcal = Math.round(r.kcal);
      existing.quick.source = r.source;
    }
  }
  const all = [...groups.values()];
  const byRecency = (a: { latestTs: number }, b: { latestTs: number }) => b.latestTs - a.latestTs;
  const repeated = all
    .filter((g) => g.quick.count >= 2)
    .sort((a, b) => b.quick.count - a.quick.count || byRecency(a, b));
  const once = all.filter((g) => g.quick.count < 2).sort(byRecency);
  return [...repeated, ...once].slice(0, limit).map((g) => g.quick);
}

/// The one-tap repeat list, drawn from the last [scan] logged workouts.
export async function quickWorkouts(
  db: AnyDb,
  opts: { limit?: number; scan?: number } = {},
): Promise<QuickWorkout[]> {
  const rows = (await db
    .select({
      type: workouts.type,
      label: workouts.label,
      minutes: workouts.minutes,
      sets: workouts.sets,
      speedKmh: workouts.speedKmh,
      intensity: workouts.intensity,
      kcal: workouts.kcal,
      source: workouts.source,
      ts: workouts.ts,
    })
    .from(workouts)
    .orderBy(desc(workouts.ts))
    .limit(opts.scan ?? 120)) as QuickWorkoutSource[];
  return deriveQuickWorkouts(rows, opts.limit ?? 8);
}

/// What repeating [q] would cost TODAY: a known type is recomputed from the
/// current weight (so a user who lost 10 kg doesn't keep re-logging the old
/// burn), an unknown activity keeps the stored number — see [QuickWorkout.kcal].
export function quickWorkoutKcal(q: QuickWorkout, weightKg: number): number {
  const known = (WORKOUT_TYPES as readonly string[]).includes(q.type);
  return known
    ? workoutKcal(q.type as WorkoutType, q.minutes, weightKg, q.speedKmh, q.intensity)
    : Math.round(Math.max(0, q.kcal));
}

/// Log a past workout again for [when], exactly as it was entered. Returns the
/// stored kcal.
export async function repeatWorkout(
  db: AnyDb,
  q: QuickWorkout,
  weightKg: number,
  when: Date = new Date(),
): Promise<number> {
  const kcal = quickWorkoutKcal(q, weightKg);
  await db.insert(workouts).values({
    ts: when,
    date: dayKey(when),
    type: q.type,
    minutes: Math.round(Math.max(0, q.minutes)),
    kcal,
    speedKmh: q.speedKmh,
    label: q.label,
    sets: q.sets,
    // Effort is a strength-only lever, same rule as [addWorkout].
    intensity: q.type === 'strength' ? q.intensity : null,
    source: q.source,
  });
  return kcal;
}

/// A day's logged workouts, newest-first.
export async function listWorkoutsForDay(
  db: AnyDb,
  date: Date | string = new Date(),
): Promise<WorkoutRow[]> {
  const key = typeof date === 'string' ? date : dayKey(date);
  return (await db
    .select()
    .from(workouts)
    .where(eq(workouts.date, key))
    .orderBy(desc(workouts.ts))) as WorkoutRow[];
}

/// RAW total kcal burned in a day's workouts (before the eat-back fraction). The
/// eat-back is applied by the plan/food layer via `withWorkoutEnergy`, so the
/// stored/summed number here stays a plain, honest "calories burned".
export async function todayWorkoutKcal(
  db: AnyDb,
  date: Date | string = new Date(),
): Promise<number> {
  const rows = await listWorkoutsForDay(db, date);
  return rows.reduce((sum, r) => sum + Number(r.kcal), 0);
}

/// Remove one logged workout by id. Deleting a DEVICE import also tombstones
/// its OS record id, so the next passive sync doesn't resurrect the row the
/// user just removed.
export async function deleteWorkout(db: AnyDb, id: number): Promise<void> {
  const rows = (await db.select().from(workouts).where(eq(workouts.id, id))) as WorkoutRow[];
  const row = rows[0];
  if (row && row.source === 'device' && row.externalId) {
    await db
      .insert(workoutImportTombstones)
      .values({ externalId: row.externalId, deletedAt: new Date() })
      .onConflictDoNothing();
  }
  await db.delete(workouts).where(eq(workouts.id, id));
}
