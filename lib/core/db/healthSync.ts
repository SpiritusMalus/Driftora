import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { kcalFromMet, workoutKcal, WORKOUT_TYPES, type WorkoutType } from '../insights/bodyMetrics';
import type { DeviceWorkoutSession, HealthService } from '../services/health';
import { mergedDayWindows, type TimeWindow } from '../services/workoutWindows';
import { getStepsRow, dayKey, setWorkoutSteps, syncDaySteps } from './steps';
import { syncDaySleep } from './sleep';
import { latestWeight, syncWeighIns } from './weight';
import { importDeviceWorkout, tombstonedIds } from './workouts';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests) — mirrors [steps.ts].
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

const DAY_MS = 24 * 60 * 60 * 1000;

/// MET for a session whose type we couldn't map ('other') and whose energy the
/// store didn't measure — Compendium "conditioning exercise, general" band.
/// Shown with «≈»; crediting 0 would hide real movement.
const UNKNOWN_SESSION_MET = 5.0;

/// Fallback weight for the MET path when no weigh-in exists yet — mirrors
/// WorkoutSection's visible 70-kg caveat.
const FALLBACK_WEIGHT_KG = 70;

export interface DayHealthResult {
  steps: number | null;
  /// The day's merged-union workout-window steps (already persisted onto
  /// steps_days.workout_steps) — callers feed it straight into
  /// stepsOutsideWorkouts without a re-read.
  workoutSteps: number;
}

/// Local midnight for the given day.
function startOfDay(day: Date): Date {
  const [y, m, d] = dayKey(day).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/// ONE passive sync for a day. Steps + sleep always run (existing behavior,
/// byte-for-byte); the extended imports — device workouts with the exact
/// window-step subtraction, and scale weigh-ins — run ONLY when the user
/// enabled extended import (`app_settings.health_import_extended`). Callers on
/// the budget screens MUST run this BEFORE reading todayWorkoutKcal, or the
/// day's freshly imported sessions miss the number they're about to show.
export async function syncDayHealth(
  db: AnyDb,
  service: HealthService,
  day: Date = new Date(),
  extended = false,
): Promise<DayHealthResult> {
  const steps = await syncDaySteps(db, service, day);
  await syncDaySleep(db, service, day);
  if (!extended) {
    const row = await getStepsRow(db, day);
    return { steps, workoutSteps: row ? Number(row.workoutSteps) : 0 };
  }
  const workoutSteps = await syncDayWorkouts(db, service, day);
  await syncWeighIns(db, service, 1, day);
  return { steps, workoutSteps };
}

/// Imports the day's device workout sessions and recomputes the day's
/// workout-step subtraction. Re-run on every sync: watch step/energy data often
/// lands minutes after the session ends, so the numbers firm up while the day
/// is in the sync horizon and freeze naturally once it leaves. Returns the
/// persisted union steps (0 when the service can't read sessions).
export async function syncDayWorkouts(
  db: AnyDb,
  service: HealthService,
  day: Date = new Date(),
): Promise<number> {
  const stored = async () => {
    const row = await getStepsRow(db, day);
    return row ? Number(row.workoutSteps) : 0;
  };
  if (!service.workoutSessionsForDay) return stored();
  const sessions = await service.workoutSessionsForDay(day);
  if (sessions == null) return stored();

  const dayStart = startOfDay(day).getTime();
  const dayEnd = dayStart + DAY_MS;
  const dead = await tombstonedIds(db, sessions.map((s) => s.externalId));
  const weightKg = (await latestWeight(db))?.weightKg ?? FALLBACK_WEIGHT_KG;

  const windows: TimeWindow[] = [];
  for (const session of sessions) {
    if (dead.has(session.externalId)) continue;
    const startMs = new Date(session.start).getTime();
    const endMs = new Date(session.end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    windows.push({ start: startMs, end: endMs });
    const minutes = Math.max(1, Math.round((endMs - startMs) / 60000));
    const resolved = await resolveSessionKcal(service, session, startMs, endMs, minutes, weightKg);
    await importDeviceWorkout(db, {
      externalId: session.externalId,
      start: new Date(startMs),
      end: new Date(endMs),
      type: session.type,
      title: session.title,
      minutes,
      kcal: resolved.kcal,
      kcalFrom: resolved.from,
      stepsInWindow: service.stepsInWindow
        ? await service.stepsInWindow(new Date(startMs), new Date(endMs))
        : null,
    });
  }

  // The subtraction uses the MERGED union of the day's windows, clipped to the
  // day — never a per-row sum (overlapping sessions would double-subtract; a
  // midnight-crosser contributes only its inside-the-day stretch here, its
  // other stretch belongs to the neighbor day's own sync).
  let unionSteps = 0;
  if (service.stepsInWindow) {
    for (const w of mergedDayWindows(windows, dayStart, dayEnd)) {
      const n = await service.stepsInWindow(new Date(w.start), new Date(w.end));
      if (n != null && Number.isFinite(n)) unionSteps += Math.max(0, n);
    }
  }
  unionSteps = Math.round(unionSteps);
  await setWorkoutSteps(db, day, unionSteps);
  return unionSteps;
}

/// kcal priority for a session: (1) the OS-deduplicated energy aggregate inside
/// the window — the measured burn; (2) the session's own stored total (iOS);
/// (3) the app's ≈MET estimate — same math as an identical manual log, marked
/// with «≈» in the UI via kcalFrom='met'.
async function resolveSessionKcal(
  service: HealthService,
  session: DeviceWorkoutSession,
  startMs: number,
  endMs: number,
  minutes: number,
  weightKg: number,
): Promise<{ kcal: number; from: 'device' | 'met' }> {
  if (service.activeKcalInWindow) {
    const measured = await service.activeKcalInWindow(new Date(startMs), new Date(endMs));
    if (measured != null && measured > 0) return { kcal: measured, from: 'device' };
  }
  if (session.deviceKcal != null && session.deviceKcal > 0) {
    return { kcal: session.deviceKcal, from: 'device' };
  }
  const known = (WORKOUT_TYPES as readonly string[]).includes(session.type);
  const kcal = known
    ? workoutKcal(session.type as WorkoutType, minutes, weightKg)
    : kcalFromMet(UNKNOWN_SESSION_MET, minutes, weightKg);
  return { kcal, from: 'met' };
}

/// Fire-and-forget history pull after the user first connects extended import:
/// weigh-ins over [weightDays], sessions over [workoutDays]. Workouts default
/// to 14, not 30, deliberately — a 30-day import silently rewrites a month of
/// history-day budgets; 14 keeps the blast radius reviewable (Health Connect
/// caps un-privileged reads at 30 days anyway).
export async function backfillHealth(
  db: AnyDb,
  service: HealthService,
  opts: { weightDays?: number; workoutDays?: number } = {},
  now: Date = new Date(),
): Promise<void> {
  const weightDays = opts.weightDays ?? 30;
  const workoutDays = opts.workoutDays ?? 14;
  await syncWeighIns(db, service, weightDays, now);
  for (let back = workoutDays - 1; back >= 0; back--) {
    await syncDayWorkouts(db, service, new Date(now.getTime() - back * DAY_MS));
  }
}
