import { and, count, gte, isNull, lt } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { logDaysInRange, startOfWeek, weeklyStreak } from '../insights/engagement';
import { selfInitiatedLogDays } from './activity';
import { fiberOfMicros } from './food';
import { ensureSettings } from './settings';
import { diaryEntries, foodEntries, stepsDays, wins, workouts } from './schema';
import { dayKey } from './steps';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests). Query builders are awaitable for both.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// Aggregates for one week. Averages are over the days that actually have data
/// (a steps row, a food log, a workout) — never punishing a quiet day with a zero.
export interface WeekStats {
  stepsAvg: number;
  stepsDayCount: number;
  proteinAvg: number;
  /// Fiber g/day over the days with food logs — the metric the science push
  /// (#181/#213) says matters and the one this screen never showed. Entries
  /// logged before fiber existed in the data count as 0, which biases both
  /// compared weeks the same way — honest enough for self-vs-past-self.
  fiberAvg: number;
  kcalAvg: number;
  foodLogDays: number;
  diaryCount: number;
  winsCount: number;
  /// Sessions logged this week, ANY source — device imports included. This is
  /// the week the BODY had; the streak is the one that cares who typed it (see
  /// [selfInitiatedLogDays]). Workouts moved the eating budget every day they
  /// happened and were the one thing this review never mentioned.
  workoutCount: number;
  /// Minutes averaged over the days that HAD a workout — rest days are not
  /// averaged in, same rule as the steps/food averages above. So three 45-min
  /// sessions read «45 мин», and how OFTEN is told by `workoutCount` next to it.
  workoutMinutesAvg: number;
}

export interface WeekReview {
  thisWeek: WeekStats;
  lastWeek: WeekStats;
  /// Forgiving weekly streak (consecutive weeks with ≥1 self-initiated log).
  streakWeeks: number;
  /// North-star: self-initiated log days in the current week.
  northStarThisWeek: number;
  weekStart: string; // 'YYYY-MM-DD' (Monday)
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

async function statsForWindow(db: AnyDb, start: Date, end: Date): Promise<WeekStats> {
  const startKey = dayKey(start);
  const endKey = dayKey(end);

  // 'YYYY-MM-DD' sorts lexically, so text range filters on the PK work.
  const steps = (await db
    .select({ steps: stepsDays.steps })
    .from(stepsDays)
    .where(and(gte(stepsDays.date, startKey), lt(stepsDays.date, endKey)))) as { steps: number }[];
  const stepsDayCount = steps.length;
  const stepsAvg = stepsDayCount
    ? Math.round(steps.reduce((a, r) => a + Number(r.steps), 0) / stepsDayCount)
    : 0;

  // Background-parse rows are NOT food logs: a `parse_status` row carries zero
  // macros — «разбирается…» while the photo is out, «не распозналось» forever if
  // the parse died with its process and the user never retried or deleted it.
  // Counted, such a row makes its day a «день с записями еды» and averages a 0
  // into the week: six real 2000-kcal days plus one failed-photo day reported
  // 1714 kcal/day. The average must be over days that actually hold food.
  const foods = (await db
    .select({ ts: foodEntries.ts, proteinG: foodEntries.proteinG, kcal: foodEntries.kcal, micros: foodEntries.micros })
    .from(foodEntries)
    .where(and(gte(foodEntries.ts, start), lt(foodEntries.ts, end), isNull(foodEntries.parseStatus)))) as {
    ts: Date;
    proteinG: number;
    kcal: number;
    micros: string | null;
  }[];
  const foodDays = new Set<string>();
  let proteinSum = 0;
  let fiberSum = 0;
  let kcalSum = 0;
  for (const f of foods) {
    foodDays.add(dayKey(f.ts));
    proteinSum += f.proteinG;
    fiberSum += fiberOfMicros(f.micros) ?? 0;
    kcalSum += f.kcal;
  }
  const foodLogDays = foodDays.size;
  const proteinAvg = foodLogDays ? Math.round(proteinSum / foodLogDays) : 0;
  const fiberAvg = foodLogDays ? Math.round(fiberSum / foodLogDays) : 0;
  const kcalAvg = foodLogDays ? Math.round(kcalSum / foodLogDays) : 0;

  // Ranged on the stored day key, not `ts`: that column is what every other
  // workout surface groups by, and for a device import it holds the SESSION
  // START day — so a session that crosses midnight lands in exactly one week.
  const workoutRows = (await db
    .select({ date: workouts.date, minutes: workouts.minutes })
    .from(workouts)
    .where(and(gte(workouts.date, startKey), lt(workouts.date, endKey)))) as {
    date: string;
    minutes: number;
  }[];
  const workoutDays = new Set(workoutRows.map((w) => w.date));
  const workoutMinutes = workoutRows.reduce((a, w) => a + Number(w.minutes), 0);
  const workoutMinutesAvg = workoutDays.size ? Math.round(workoutMinutes / workoutDays.size) : 0;

  const [diaryRows, winsRows] = await Promise.all([
    db.select({ c: count() }).from(diaryEntries).where(and(gte(diaryEntries.ts, start), lt(diaryEntries.ts, end))),
    db.select({ c: count() }).from(wins).where(and(gte(wins.ts, start), lt(wins.ts, end))),
  ]);

  return {
    stepsAvg,
    stepsDayCount,
    proteinAvg,
    fiberAvg,
    kcalAvg,
    foodLogDays,
    diaryCount: Number(diaryRows[0]?.c ?? 0),
    winsCount: Number(winsRows[0]?.c ?? 0),
    workoutCount: workoutRows.length,
    workoutMinutesAvg,
  };
}

/// This-week-vs-last-week review plus the streak and north-star. Self vs.
/// past-self only — no population comparison, no weight/deficit optimization.
export async function weekReview(db: AnyDb, today: Date = new Date()): Promise<WeekReview> {
  const thisStart = startOfWeek(today);
  const thisEnd = addDays(thisStart, 7);
  const lastStart = addDays(thisStart, -7);

  const [thisWeek, lastWeek, logDays, settings] = await Promise.all([
    statsForWindow(db, thisStart, thisEnd),
    statsForWindow(db, lastStart, thisStart),
    selfInitiatedLogDays(db),
    ensureSettings(db),
  ]);

  return {
    thisWeek,
    lastWeek,
    streakWeeks: weeklyStreak(logDays, today, undefined, settings.streakRestartedAt).weeks,
    northStarThisWeek: logDaysInRange(logDays, thisStart, thisEnd),
    weekStart: dayKey(thisStart),
  };
}
