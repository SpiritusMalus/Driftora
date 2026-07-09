import { desc, eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { kcalFromMet, workoutKcal, WORKOUT_TYPES, type WorkoutType } from '../insights/bodyMetrics';
import { workouts, type WorkoutRow } from './schema';
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
): Promise<number> {
  const kcal = workoutKcal(type, minutes, weightKg, speedKmh);
  await db.insert(workouts).values({
    ts: when,
    date: dayKey(when),
    type,
    minutes: Math.round(Math.max(0, minutes)),
    kcal,
    speedKmh: speedKmh != null && speedKmh > 0 ? speedKmh : null,
    sets: sets != null && sets > 0 ? Math.round(sets) : null,
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

/// Remove one logged workout by id.
export async function deleteWorkout(db: AnyDb, id: number): Promise<void> {
  await db.delete(workouts).where(eq(workouts.id, id));
}
