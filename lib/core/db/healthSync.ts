import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import {
  kcalFromMet,
  restingRateForProfile,
  workoutKcal,
  WORKOUT_TYPES,
  type WorkoutType,
} from '../insights/bodyMetrics';
import { ensureSettings } from './settings';
import type { DeviceWorkoutSession, HealthService } from '../services/health';
import { mergedDayWindows, subtractWindows, type TimeWindow } from '../services/workoutWindows';
import { upsertHealthDay } from './healthDays';
import { getStepsRow, dayKey, setWorkoutSteps, syncDaySteps } from './steps';
import { syncDaySleep } from './sleep';
import { latestWeight, syncWeighIns } from './weight';
import { importDeviceWorkout, tombstonedIds, workoutWindowsForDay } from './workouts';

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

/// [n] local days before [now], anchored at midday. Deliberately NOT
/// `now - n × 86 400 000`: that arithmetic is in UTC milliseconds, so a clock
/// change repeats or skips a local day, and the midday anchor makes the result
/// immune to it.
function daysBefore(now: Date, n: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - n, 12, 0, 0);
}

/// How far back a catch-up looks. Health Connect serves 30 days without
/// privileged access and HealthKit more, so the ceiling here is attention, not
/// availability: a fortnight covers a holiday away from the app while keeping
/// the worst-case catch-up bounded.
export const CATCHUP_DAYS = 14;

/// ONE passive sync for a day. Steps, sleep and the workout-step subtraction
/// always run; the extended IMPORTS — pulling device workout sessions, and scale
/// weigh-ins — run ONLY when the user enabled extended import
/// (`app_settings.health_import_extended`). Callers on the budget screens MUST
/// run this BEFORE reading todayWorkoutKcal, or the day's freshly imported
/// sessions miss the number they're about to show.
///
/// The subtraction moved OUT of the extended branch deliberately: it prices the
/// windows already in the database, and a hand-logged walk has one of those
/// whether or not the user ever connected a watch. Leaving it inside meant the
/// default configuration — steps on, device import off — never subtracted
/// anything and paid for every logged walk twice.
export async function syncDayHealth(
  db: AnyDb,
  service: HealthService,
  day: Date = new Date(),
  extended = false,
): Promise<DayHealthResult> {
  const steps = await syncDaySteps(db, service, day);
  await syncDaySleep(db, service, day);
  if (!extended) {
    return { steps, workoutSteps: await recomputeWorkoutSteps(db, service, day) };
  }
  const workoutSteps = await syncDayWorkouts(db, service, day);
  await syncWeighIns(db, service, 1, day);
  await syncDayBodySignals(db, service, day);
  return { steps, workoutSteps };
}

/// Fills in the days the app simply wasn't opened on. Every passive sync here
/// asks for `new Date()` and nothing else, so before this a skipped day was lost
/// permanently: the watch had recorded it and the store would still serve it,
/// but nobody ever asked again. Open the app twice a week and five days in seven
/// stayed blank — which is exactly what «данные с часов редко доезжают» looks
/// like from the outside.
///
/// Cheap in the common case: a day that already has a `steps_days` row is
/// skipped after one keyed read, so a daily user pays [CATCHUP_DAYS] tiny
/// selects and no provider calls at all. Walks oldest→newest so an interrupted
/// run still leaves the most recent days done.
///
/// Stops after [CATCHUP_MISS_LIMIT] consecutive days the provider serves
/// nothing — a revoked permission, an absent Health Connect and a phone left in
/// a drawer all look like that, and walking the rest of the fortnight to hear
/// the same silence costs the user's battery for nothing. Returns how many days
/// it actually filled.
const CATCHUP_MISS_LIMIT = 3;

export async function catchUpHealth(
  db: AnyDb,
  service: HealthService,
  extended = false,
  now: Date = new Date(),
): Promise<number> {
  let filled = 0;
  let misses = 0;
  for (let back = CATCHUP_DAYS; back >= 1; back--) {
    const day = daysBefore(now, back);
    // A row means the day was synced (or hand-entered) once already. Skipping is
    // cheaper than re-asking, and it keeps a manual count untouched — which
    // syncDaySteps also guards, but this way the provider is never even called.
    if (await getStepsRow(db, day)) {
      misses = 0;
      continue;
    }
    const res = await syncDayHealth(db, service, day, extended);
    if (res.steps == null) {
      if (++misses >= CATCHUP_MISS_LIMIT) break;
      continue;
    }
    misses = 0;
    filled++;
  }
  return filled;
}

/// Pulls the day's informational body/night signals (resting HR, HRV, SpO₂,
/// respiratory rate, VO₂max) into health_days. Display only — never calories.
export async function syncDayBodySignals(
  db: AnyDb,
  service: HealthService,
  day: Date = new Date(),
): Promise<boolean> {
  if (!service.bodySignalsForDay) return false;
  const signals = await service.bodySignalsForDay(day);
  if (signals == null) return false;
  return upsertHealthDay(db, day, signals);
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
  if (service.workoutSessionsForDay) {
    const sessions = await service.workoutSessionsForDay(day);
    if (sessions != null) await importDeviceSessions(db, service, sessions);
  }
  return recomputeWorkoutSteps(db, service, day);
}

/// Imports the given sessions, giving each one the energy of its EXCLUSIVE
/// stretch only. Sessions are walked earliest-first and each claims its window,
/// so a later session that overlaps an earlier one is priced on what's left.
///
/// Without this the shared stretch was billed to both rows and `todayWorkoutKcal`
/// summed them — the exact double-count the steps side has merged away since it
/// was written, on the bigger of the two numbers. The overlap is not exotic: a
/// watch auto-detects the walk you also started manually, which is the very
/// scenario [workoutWindows] was created for.
async function importDeviceSessions(
  db: AnyDb,
  service: HealthService,
  sessions: DeviceWorkoutSession[],
): Promise<void> {
  const dead = await tombstonedIds(db, sessions.map((s) => s.externalId));
  const weightKg = (await latestWeight(db))?.weightKg ?? FALLBACK_WEIGHT_KG;
  // The ≈MET fallback must subtract the same resting cost a hand-logged session
  // would, or the two paths disagree about the same activity.
  const s = await ensureSettings(db);
  const restingRate = restingRateForProfile(
    {
      sex: s.sex,
      birthYear: s.birthYear,
      heightCm: s.heightCm,
      activityLevel: s.activityLevel,
      bodyFatPct: s.bodyFatPct,
      waistCm: s.waistCm,
      bmrFactor: s.bmrFactor,
    },
    weightKg,
  );
  const usable = sessions
    .filter((s) => !dead.has(s.externalId))
    .map((s) => ({ s, start: new Date(s.start).getTime(), end: new Date(s.end).getTime() }))
    .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    // Earliest-first so «who claimed the overlap» is deterministic and a re-sync
    // reproduces the same split instead of shuffling kcal between two rows.
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const claimed: TimeWindow[] = [];
  for (const { s: session, start: startMs, end: endMs } of usable) {
    const exclusive = subtractWindows({ start: startMs, end: endMs }, claimed);
    claimed.push({ start: startMs, end: endMs });
    // Minutes stay the session's FULL duration — that's what the user actually
    // did, and it's what the row shows. Only the energy is apportioned.
    const minutes = Math.max(1, Math.round((endMs - startMs) / 60000));
    const resolved = await resolveSessionKcal(
      service,
      session,
      exclusive,
      endMs - startMs,
      minutes,
      weightKg,
      restingRate,
    );
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
}

/// Recomputes the day's workout-step subtraction from every window stored for
/// the day — imported sessions AND hand-logged rows alike (see
/// [workoutWindowsForDay]). Reading the DB rather than only the sessions just
/// fetched is what lets a typed-in walk subtract its own steps: before this,
/// `workout_steps` was written solely by the device-import path, so with the
/// extended import off (the default) nothing ever subtracted and one walk was
/// paid for twice — once as «шаги +N», once as the workout itself.
///
/// The subtraction uses the MERGED union clipped to the day — never a per-row
/// sum (overlapping windows would double-subtract; a midnight-crosser
/// contributes only its inside-the-day stretch here, its other stretch belongs
/// to the neighbor day's own sync). Returns the persisted union steps; when the
/// service can't price a window at all the stored value is left alone rather
/// than zeroed.
export async function recomputeWorkoutSteps(
  db: AnyDb,
  service: HealthService,
  day: Date = new Date(),
): Promise<number> {
  if (!service.stepsInWindow) {
    const row = await getStepsRow(db, day);
    return row ? Number(row.workoutSteps) : 0;
  }
  const dayStart = startOfDay(day).getTime();
  const dayEnd = dayStart + DAY_MS;
  const windows = await workoutWindowsForDay(db, new Date(dayStart), new Date(dayEnd));
  let unionSteps = 0;
  for (const w of mergedDayWindows(windows, dayStart, dayEnd)) {
    const n = await service.stepsInWindow(new Date(w.start), new Date(w.end));
    if (n != null && Number.isFinite(n)) unionSteps += Math.max(0, n);
  }
  unionSteps = Math.round(unionSteps);
  await setWorkoutSteps(db, day, unionSteps);
  return unionSteps;
}

/// kcal priority for a session: (1) the OS-deduplicated energy aggregate inside
/// the window — the measured burn; (2) the session's own stored total (iOS);
/// (3) the app's ≈MET estimate — same math as an identical manual log, marked
/// with «≈» in the UI via kcalFrom='met'.
///
/// All three are priced on [exclusive] — the stretches this session doesn't
/// share with an earlier one (see [importDeviceSessions]). The measured path
/// asks the OS per exclusive piece, which is exact; the two estimate paths have
/// no per-interval source to ask, so they scale by the exclusive share of the
/// session. A session fully covered by an earlier one earns 0 rather than a
/// second copy of the same energy.
async function resolveSessionKcal(
  service: HealthService,
  session: DeviceWorkoutSession,
  exclusive: TimeWindow[],
  windowMs: number,
  minutes: number,
  weightKg: number,
  restingRate?: number,
): Promise<{ kcal: number; from: 'device' | 'met' }> {
  const exclusiveMs = exclusive.reduce((s, w) => s + (w.end - w.start), 0);
  if (exclusiveMs <= 0) return { kcal: 0, from: 'device' };
  const share = windowMs > 0 ? Math.min(1, exclusiveMs / windowMs) : 1;

  if (service.activeKcalInWindow) {
    let measured = 0;
    for (const w of exclusive) {
      const n = await service.activeKcalInWindow(new Date(w.start), new Date(w.end));
      if (n != null && Number.isFinite(n)) measured += Math.max(0, n);
    }
    if (measured > 0) return { kcal: measured, from: 'device' };
  }
  if (session.deviceKcal != null && session.deviceKcal > 0) {
    return { kcal: session.deviceKcal * share, from: 'device' };
  }
  const known = (WORKOUT_TYPES as readonly string[]).includes(session.type);
  const activeMinutes = minutes * share;
  const kcal = known
    ? workoutKcal(session.type as WorkoutType, activeMinutes, weightKg, null, null, restingRate)
    : kcalFromMet(UNKNOWN_SESSION_MET, activeMinutes, weightKg, restingRate);
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
  opts: { weightDays?: number; workoutDays?: number; signalDays?: number } = {},
  now: Date = new Date(),
): Promise<void> {
  const weightDays = opts.weightDays ?? 30;
  const workoutDays = opts.workoutDays ?? 14;
  const signalDays = opts.signalDays ?? 14;
  await syncWeighIns(db, service, weightDays, now);
  for (let back = workoutDays - 1; back >= 0; back--) {
    const day = daysBefore(now, back);
    // Steps first: a workout's step subtraction is an UPDATE on steps_days, so
    // without a row for that day it silently no-ops and the imported session
    // never gets its steps taken out of the day's earnings. Backfill used to
    // skip steps entirely, which left exactly that hole across the whole
    // imported fortnight.
    await syncDaySteps(db, service, day);
    await syncDaySleep(db, service, day);
    await syncDayWorkouts(db, service, day);
  }
  for (let back = signalDays - 1; back >= 0; back--) {
    await syncDayBodySignals(db, service, daysBefore(now, back));
  }
}
