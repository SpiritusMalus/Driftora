import { and, desc, eq, gt, inArray, lt } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import {
  kcalFromMet,
  STRENGTH_INTENSITIES,
  workoutKcal,
  WORKOUT_TYPES,
  type StrengthIntensity,
  type WorkoutType,
} from '../insights/bodyMetrics';
import type { TimeWindow } from '../services/workoutWindows';
import { workoutImportTombstones, workouts, type WorkoutRow } from './schema';
import { dayKey } from './steps';
import { withDbLock, withTx } from './tx';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests) — mirrors [steps.ts].
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// Log one workout for a day. kcal is computed HERE from the then-current weight
/// ((MET − the user's resting rate) × kg × hours) and stored, so the number
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
  restingRate?: number,
): Promise<number> {
  const kcal = workoutKcal(type, minutes, weightKg, speedKmh, intensity, restingRate);
  // Queued, like the device import below: a hand-logged session can be saved
  // while an adopted photo parse holds its transaction open, and a bare write
  // then joins it — and vanishes with its rollback. See lib/core/db/tx.ts.
  await withDbLock(
    db,
    () =>
      db.insert(workouts).values({
        ts: when,
        date: dayKey(when),
        type,
        minutes: Math.round(Math.max(0, minutes)),
        kcal,
        speedKmh: speedKmh != null && speedKmh > 0 ? speedKmh : null,
        sets: sets != null && sets > 0 ? Math.round(sets) : null,
        // Effort is a strength-only lever; store it only where it shaped the MET.
        intensity: type === 'strength' && intensity != null ? intensity : null,
        ...(loggedWindow(when, minutes) ?? {}),
      }),
    'addWorkout',
  );
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
  /// Strength-only effort level as the model reported it — a free-form string
  /// off the wire, validated here before it can shape the MET.
  intensity?: string | null;
}

/// The reported effort, but only when it's one of ours AND the type is one the
/// effort lever applies to. Anything else → null, i.e. the conservative fixed
/// MET. Guards a model that invents an effort word or attaches one to a run.
function validIntensity(type: string, raw: string | null | undefined): StrengthIntensity | null {
  if (type !== 'strength' || raw == null) return null;
  return (STRENGTH_INTENSITIES as readonly string[]).includes(raw) ? (raw as StrengthIntensity) : null;
}

/// The time window a hand-logged workout occupied: it ended when you logged it,
/// and it lasted `minutes`. A guess, and deliberately so — without it the steps
/// you took DURING a logged walk are also priced as «шаги +N», so one walk pays
/// twice (the device-import path has subtracted its sessions' steps since day
/// one; hand-logged rows had no window to subtract by and quietly kept the
/// double count). Logging right after finishing is the norm the budget-ack
/// nudges toward, so the guess is usually right; when it's wrong it removes
/// steps that weren't the workout's, which undercredits rather than overcredits
/// — the same direction every other estimate here leans.
///
/// Null for a zero-duration entry («по часам», kcal with no minutes): there is
/// no stretch to attribute, and a zero-length window subtracts nothing anyway.
function loggedWindow(when: Date, minutes: number): { startTs: Date; endTs: Date } | null {
  const min = Math.min(Math.max(0, Math.round(minutes)), 600);
  if (min <= 0) return null;
  return { startTs: new Date(when.getTime() - min * 60_000), endTs: when };
}

/// Log a workout parsed from free text. kcal is computed HERE (client-side) from
/// the user's weight — a known type uses the app's MET (pace-refined when given,
/// effort-refined for strength), an 'other' activity uses the model's MET. The
/// model's phrasing is kept in `label` so the log shows what was actually done;
/// its minutes stay the duration basis even when sets are present (the model saw
/// the reps detail — a fixed per-set constant would be a worse estimate).
///
/// Effort rides the same path as the manual form's chip: a described «тяжёлый
/// присед» used to land on the light 3.5 MET because this path dropped the
/// lever, so the same session cost ~40% less by voice than by form. An ABSENT
/// effort still means the fixed moderate MET — we refine what the user said, we
/// don't invent a level they didn't. Returns the stored kcal.
export async function addParsedWorkout(
  db: AnyDb,
  parsed: ParsedWorkoutInput,
  weightKg: number,
  when: Date = new Date(),
  restingRate?: number,
): Promise<number> {
  const known = (WORKOUT_TYPES as readonly string[]).includes(parsed.type);
  const speedKmh = parsed.speedKmh != null && parsed.speedKmh > 0 ? parsed.speedKmh : null;
  const intensity = validIntensity(parsed.type, parsed.intensity);
  const kcal = known
    ? workoutKcal(parsed.type as WorkoutType, parsed.minutes, weightKg, speedKmh, intensity, restingRate)
    : kcalFromMet(parsed.met ?? 0, parsed.minutes, weightKg, restingRate);
  await withDbLock(
    db,
    () =>
      db.insert(workouts).values({
        ts: when,
        date: dayKey(when),
        type: parsed.type,
        minutes: Math.round(Math.max(0, parsed.minutes)),
        kcal,
        speedKmh,
        label: parsed.name_ru.trim() || null,
        sets: parsed.sets != null && parsed.sets > 0 ? Math.round(parsed.sets) : null,
        intensity,
        source: 'ai',
        ...(loggedWindow(when, parsed.minutes) ?? {}),
      }),
    'addParsedWorkout',
  );
  return kcal;
}

/// Log a workout whose burn came from the user's OWN tracker screenshot: the
/// device measured it (heart rate + sensors), so its printed kcal is stored
/// VERBATIM instead of a MET estimate. NOT because it is more accurate — wrist
/// devices miss energy expenditure by >30% MAPE against indirect calorimetry, and
/// the bias has no consistent direction — but because it is the number the user
/// is looking at, and silently overriding it would be worse than carrying it with
/// an «≈». Clamped to a sane band so an OCR
/// misread can't blow up the day. Returns the stored kcal.
export async function addTrackerWorkout(
  db: AnyDb,
  input: { kcal: number; minutes: number; type?: string; label?: string | null; sets?: number | null },
  when: Date = new Date(),
): Promise<number> {
  const kcal = Math.round(Math.min(Math.max(0, input.kcal), 5000));
  await withDbLock(
    db,
    () =>
      db.insert(workouts).values({
        ts: when,
        date: dayKey(when),
        type: input.type ?? 'other',
        minutes: Math.round(Math.min(Math.max(0, input.minutes), 600)),
        kcal,
        speedKmh: null,
        label: input.label?.trim() || null,
        sets: input.sets != null && input.sets > 0 ? Math.round(input.sets) : null,
        source: 'tracker',
        // A screenshot that named a duration still tells us how long you moved,
        // so those steps get attributed here like any hand-logged session. The
        // plain «по часам» entry carries kcal and no minutes — no window,
        // nothing to subtract (see [loggedWindow]).
        ...(loggedWindow(when, input.minutes) ?? {}),
      }),
    'addTrackerWorkout',
  );
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
  // One unit through the queue: this is a read-check-then-write (tombstone
  // lookup → update-or-insert), so an interleaved neighbour can both invalidate
  // the check and swallow the write into its own rollback.
  return withDbLock(db, () => importDeviceWorkoutUnlocked(db, input), 'importDeviceWorkout');
}

async function importDeviceWorkoutUnlocked(db: AnyDb, input: DeviceWorkoutInput): Promise<boolean> {
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
export function quickWorkoutKcal(q: QuickWorkout, weightKg: number, restingRate?: number): number {
  const known = (WORKOUT_TYPES as readonly string[]).includes(q.type);
  return known
    ? workoutKcal(q.type as WorkoutType, q.minutes, weightKg, q.speedKmh, q.intensity, restingRate)
    : Math.round(Math.max(0, q.kcal));
}

/// Log a past workout again for [when], exactly as it was entered. Returns the
/// stored kcal.
export async function repeatWorkout(
  db: AnyDb,
  q: QuickWorkout,
  weightKg: number,
  when: Date = new Date(),
  restingRate?: number,
): Promise<number> {
  const kcal = quickWorkoutKcal(q, weightKg, restingRate);
  await withDbLock(
    db,
    () =>
      db.insert(workouts).values({
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
        ...(loggedWindow(when, q.minutes) ?? {}),
      }),
    'repeatWorkout',
  );
  return kcal;
}

/// Every workout window that overlaps [dayStart, dayEnd) — device sessions AND
/// hand-logged rows, which now carry a window too (see [loggedWindow]). The
/// steps subtraction reads this instead of only the sessions it just imported,
/// so a walk you typed in subtracts its own steps exactly like a watch-detected
/// one does.
///
/// Selected by OVERLAP, not by the `date` column: a session that crossed
/// midnight is dated to its start day, but the stretch after midnight belongs to
/// the next day's step count and has to be subtractable there. The caller clips
/// to the day before pricing.
export async function workoutWindowsForDay(
  db: AnyDb,
  dayStart: Date,
  dayEnd: Date,
): Promise<TimeWindow[]> {
  const rows = (await db
    .select({ startTs: workouts.startTs, endTs: workouts.endTs })
    .from(workouts)
    .where(and(gt(workouts.endTs, dayStart), lt(workouts.startTs, dayEnd)))) as {
    startTs: Date | null;
    endTs: Date | null;
  }[];
  const out: TimeWindow[] = [];
  for (const r of rows) {
    const start = r.startTs?.getTime();
    const end = r.endTs?.getTime();
    if (start == null || end == null || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end > start) out.push({ start, end });
  }
  return out;
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
  // Atomic: a tombstone without its delete silently blocks a session the user
  // still has, and a delete without its tombstone lets the next sync resurrect
  // the row they just removed. Neither half is recoverable from the UI.
  await withTx(
    db,
    async () => {
      const rows = (await db.select().from(workouts).where(eq(workouts.id, id))) as WorkoutRow[];
      const row = rows[0];
      if (row && row.source === 'device' && row.externalId) {
        await db
          .insert(workoutImportTombstones)
          .values({ externalId: row.externalId, deletedAt: new Date() })
          .onConflictDoNothing();
      }
      await db.delete(workouts).where(eq(workouts.id, id));
    },
    'deleteWorkout',
  );
}

/// One logged workout by id — what the edit screen opens on. Null when the row
/// is gone (a stale deep link, or a delete from another screen).
export async function getWorkout(db: AnyDb, id: number): Promise<WorkoutRow | null> {
  const rows = (await db.select().from(workouts).where(eq(workouts.id, id))) as WorkoutRow[];
  return rows[0] ?? null;
}

/// What an edit may change about a logged session. Everything the three add
/// paths could set, plus `date` — «записал не в тот день» is the single most
/// common thing to fix, and re-logging by hand is a worse answer than moving
/// the row. `kcal` is honoured ONLY for a MEASURED row («по трекеру» / «с
/// часов»): its number is the user's own reading, and our MET math must never
/// silently overwrite it.
export interface WorkoutEdit {
  type: string;
  label: string | null;
  minutes: number;
  sets: number | null;
  speedKmh: number | null;
  intensity: StrengthIntensity | null;
  date?: string | null;
  kcal?: number | null;
}

/// An unknown ('other', AI-parsed) activity's MET came from the model and was
/// never stored, so there is nothing to recompute from — its cost PER MINUTE is
/// all we have. Editing the duration therefore scales the stored estimate
/// instead of inventing a MET. A zero-minute row (nothing to scale by) keeps its
/// number as-is.
function rescaleKcal(storedKcal: number, storedMinutes: number, minutes: number): number {
  const from = Math.max(0, Math.round(storedMinutes));
  const stored = Math.round(Math.max(0, storedKcal));
  if (from <= 0 || minutes <= 0) return stored;
  return Math.round(Math.min((stored * minutes) / from, 5000));
}

/// The same clock time, on another calendar day — how «перенести на другой день»
/// re-dates a session: the day changes, the position within the day doesn't.
function movedTs(ts: Date, dateKey: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return ts;
  const d = new Date(ts);
  // All three at once — setting them one by one can overflow through a short
  // month (31 → февраль) before the day lands.
  d.setFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d;
}

/// What an edited row would cost, by the same three rules the write below uses:
/// a measured number stays verbatim, a known type is recomputed from the CURRENT
/// weight, an unknown one scales with its duration. Pure, so the edit screen can
/// show the live «≈ N ккал» preview from the exact math that will be stored —
/// a preview that disagrees with the saved number is worse than none.
export function editedWorkoutKcal(
  row: { source: string; kcal: number; minutes: number },
  edit: WorkoutEdit,
  weightKg: number,
  restingRate?: number,
): number {
  const minutes = Math.round(Math.min(Math.max(0, edit.minutes), 600));
  const measured = row.source === 'tracker' || row.source === 'device';
  if (measured) {
    const raw = edit.kcal != null ? edit.kcal : Number(row.kcal);
    return Math.round(Math.min(Math.max(0, raw), 5000));
  }
  const speedKmh = edit.speedKmh != null && edit.speedKmh > 0 ? edit.speedKmh : null;
  const intensity = validIntensity(edit.type, edit.intensity);
  if ((WORKOUT_TYPES as readonly string[]).includes(edit.type)) {
    return workoutKcal(edit.type as WorkoutType, minutes, weightKg, speedKmh, intensity, restingRate);
  }
  return rescaleKcal(Number(row.kcal), row.minutes, minutes);
}

/// Save an edit to a logged workout. Returns the stored kcal (0 when the row is
/// already gone).
///
/// The steps window is rebuilt from the new duration for user-logged rows —
/// otherwise a session shortened from 60 to 20 minutes would keep subtracting an
/// hour of steps from the day. A DEVICE row's window is REAL (the watch measured
/// it) and is left alone; so is its kcal, unless one is passed explicitly.
export async function updateWorkout(
  db: AnyDb,
  id: number,
  edit: WorkoutEdit,
  weightKg: number,
  restingRate?: number,
): Promise<number> {
  // Read-then-write in one unit, like [deleteWorkout]: the row we recompute
  // from must be the row we overwrite.
  return withTx(
    db,
    async () => {
      const rows = (await db.select().from(workouts).where(eq(workouts.id, id))) as WorkoutRow[];
      const row = rows[0];
      if (!row) return 0;
      const minutes = Math.round(Math.min(Math.max(0, edit.minutes), 600));
      const kcal = editedWorkoutKcal(row, edit, weightKg, restingRate);
      const ts = edit.date ? movedTs(row.ts, edit.date) : row.ts;
      await db
        .update(workouts)
        .set({
          ts,
          date: dayKey(ts),
          type: edit.type,
          minutes,
          kcal,
          speedKmh: edit.speedKmh != null && edit.speedKmh > 0 ? edit.speedKmh : null,
          label: edit.label?.trim() || null,
          sets: edit.sets != null && edit.sets > 0 ? Math.round(edit.sets) : null,
          intensity: validIntensity(edit.type, edit.intensity),
          ...(row.source === 'device' ? {} : (loggedWindow(ts, minutes) ?? { startTs: null, endTs: null })),
        })
        .where(eq(workouts.id, id));
      return kcal;
    },
    'updateWorkout',
  );
}
