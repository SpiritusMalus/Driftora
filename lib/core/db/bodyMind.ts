import { isNotNull } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import {
  associationInsight,
  bestAssociation,
  bodyMindInsight,
  type BodyMindResult,
  type BodyMindSignal,
  type MoodStepDay,
  type SignalAssociation,
  type SignalMoodDay,
} from '../insights/bodyMind';
import { diaryEntries, foodEntries, moods, sleepDays, stepsDays } from './schema';
import { dayKey } from './steps';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests). Query builders are awaitable for both.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// Average of ALL moods per local day — diary moods + standalone check-ins — so
/// a one-tap mood feeds the same insight as a full thought record.
async function moodByDay(db: AnyDb): Promise<Map<string, number>> {
  const diaryRows = (await db
    .select({ ts: diaryEntries.ts, mood: diaryEntries.mood })
    .from(diaryEntries)
    .where(isNotNull(diaryEntries.mood))) as { ts: Date; mood: number | null }[];

  const moodRows = (await db
    .select({ ts: moods.ts, value: moods.value })
    .from(moods)) as { ts: Date; value: number }[];

  const acc = new Map<string, { sum: number; count: number }>();
  const add = (ts: Date, value: number) => {
    const day = dayKey(ts);
    const a = acc.get(day) ?? { sum: 0, count: 0 };
    a.sum += Number(value);
    a.count += 1;
    acc.set(day, a);
  };
  for (const row of diaryRows) {
    if (row.mood == null) continue; // defensive; the query already filters nulls
    add(row.ts, row.mood);
  }
  for (const row of moodRows) add(row.ts, row.value);

  const out = new Map<string, number>();
  for (const [day, m] of acc) out.set(day, m.sum / m.count);
  return out;
}

/// The per-local-day value of a body signal: steps (count), sleep (minutes) or
/// protein (grams). A day with no record for that signal is absent from the map
/// (= "no data", which must not be paired as zero — same rule as steps).
async function signalByDay(db: AnyDb, signal: BodyMindSignal): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (signal === 'steps') {
    const rows = (await db
      .select({ date: stepsDays.date, steps: stepsDays.steps })
      .from(stepsDays)) as { date: string; steps: number }[];
    for (const r of rows) out.set(r.date, Number(r.steps));
    return out;
  }
  if (signal === 'sleep') {
    const rows = (await db
      .select({ date: sleepDays.date, minutes: sleepDays.minutes })
      .from(sleepDays)) as { date: string; minutes: number }[];
    for (const r of rows) out.set(r.date, Number(r.minutes));
    return out;
  }
  // protein: sum each day's logged protein (grams) from the food log.
  const rows = (await db
    .select({ ts: foodEntries.ts, proteinG: foodEntries.proteinG })
    .from(foodEntries)) as { ts: Date; proteinG: number }[];
  for (const r of rows) {
    const day = dayKey(r.ts);
    out.set(day, (out.get(day) ?? 0) + Number(r.proteinG));
  }
  return out;
}

/// Pairs each day's mood with the chosen body signal — a day qualifies only if
/// it has BOTH. The generic input to `associationInsight`.
export async function gatherSignalMoodDays(
  db: AnyDb,
  signal: BodyMindSignal,
): Promise<SignalMoodDay[]> {
  const [moodM, signalM] = await Promise.all([moodByDay(db), signalByDay(db, signal)]);
  const points: SignalMoodDay[] = [];
  for (const [day, mood] of moodM) {
    const value = signalM.get(day);
    if (value == null) continue; // need both sides
    points.push({ day, signal: value, mood });
  }
  return points;
}

/// Runs the honest association read for every body signal we pair against mood.
export async function bodyMindSignalsFromDb(db: AnyDb): Promise<SignalAssociation[]> {
  const signals: BodyMindSignal[] = ['steps', 'sleep', 'protein'];
  return Promise.all(
    signals.map(async (signal) => ({
      signal,
      result: associationInsight(await gatherSignalMoodDays(db, signal)),
    })),
  );
}

/// The single Body↔Mind read the hero shows: the strongest honest link across
/// signals (see `bestAssociation`), or null only if there is no data at all.
export async function bestBodyMindFromDb(db: AnyDb): Promise<SignalAssociation | null> {
  return bestAssociation(await bodyMindSignalsFromDb(db));
}

// ---- original steps↔mood API (kept for back-compat + existing tests) --------

/// Builds the day-by-day (mood, steps) pairs the original Body↔Mind insight
/// reads. Thin wrapper over `gatherSignalMoodDays(db, 'steps')`.
export async function gatherMoodStepDays(db: AnyDb): Promise<MoodStepDay[]> {
  const points = await gatherSignalMoodDays(db, 'steps');
  return points.map((p) => ({ day: p.day, steps: p.signal, mood: p.mood }));
}

/// Convenience: gather the paired days and run the pure insight over them.
export async function bodyMindInsightFromDb(db: AnyDb): Promise<BodyMindResult> {
  return bodyMindInsight(await gatherMoodStepDays(db));
}
