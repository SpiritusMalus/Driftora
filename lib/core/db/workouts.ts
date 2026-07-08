import { desc, eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { workoutKcal, type WorkoutType } from '../insights/bodyMetrics';
import { workouts, type WorkoutRow } from './schema';
import { dayKey } from './steps';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests) — mirrors [steps.ts].
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// Log one workout for a day. kcal is computed HERE from the then-current weight
/// (MET × kg × hours) and stored, so the number is stable even if the user later
/// re-weighs. Returns the inserted row's kcal so callers can echo it immediately.
export async function addWorkout(
  db: AnyDb,
  type: WorkoutType,
  minutes: number,
  weightKg: number,
  when: Date = new Date(),
): Promise<number> {
  const kcal = workoutKcal(type, minutes, weightKg);
  await db.insert(workouts).values({
    ts: when,
    date: dayKey(when),
    type,
    minutes: Math.round(Math.max(0, minutes)),
    kcal,
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
