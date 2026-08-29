import { and, count, gte, isNull, lt } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { logDaysInRange, startOfWeek, weeklyStreak } from '../insights/engagement';
import { selfInitiatedLogDays } from './activity';
import { fiberOfMicros } from './food';
import { ensureSettings } from './settings';
import { latestWeight } from './weight';
import {
  dayBudgetKcal,
  restingPlan,
  stepsEarnedKcal,
  stepsOutsideWorkouts,
} from '../insights/bodyMetrics';
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
  /// Средний недобор/перебор к норме дня, ккал: минус — недоел, плюс — переел.
  /// null, когда цели нет, приложение на паузе или профиля не хватает: без
  /// нормы сравнивать не с чем, а придуманная норма хуже её отсутствия.
  /// Считается по тем же дням, что и `kcalAvg` — по дням с едой.
  kcalBalanceAvg: number | null;
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
    .select({ date: stepsDays.date, steps: stepsDays.steps, workoutSteps: stepsDays.workoutSteps })
    .from(stepsDays)
    .where(and(gte(stepsDays.date, startKey), lt(stepsDays.date, endKey)))) as {
    date: string;
    steps: number;
    workoutSteps: number | null;
  }[];
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
  const kcalByDay = new Map<string, number>();
  let proteinSum = 0;
  let fiberSum = 0;
  let kcalSum = 0;
  for (const f of foods) {
    const key = dayKey(f.ts);
    foodDays.add(key);
    kcalByDay.set(key, (kcalByDay.get(key) ?? 0) + f.kcal);
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
    .select({ date: workouts.date, minutes: workouts.minutes, kcal: workouts.kcal })
    .from(workouts)
    .where(and(gte(workouts.date, startKey), lt(workouts.date, endKey)))) as {
    date: string;
    minutes: number;
    kcal: number | null;
  }[];
  const workoutDays = new Set(workoutRows.map((w) => w.date));
  const workoutMinutes = workoutRows.reduce((a, w) => a + Number(w.minutes), 0);
  const workoutMinutesAvg = workoutDays.size ? Math.round(workoutMinutes / workoutDays.size) : 0;
  // СРЕДНИЙ НЕДОБОР/ПЕРЕБОР. Норму каждого дня собираем той же формулой, что
  // «Еда» и экран дня: resting-база плюс заработанное шагами и тренировками
  // ИМЕННО ТОГО дня — недельное среднее по шагам сгладило бы как раз то, ради
  // чего это считается (день без движения и день с прогулкой имеют разные
  // нормы). Сравниваем только по дням с едой: день без записей — это не
  // «съел ноль», это отсутствие данных.
  const settingsForPlan = await ensureSettings(db);
  const planActive = settingsForPlan.targetsSetAt != null && !settingsForPlan.paused;
  const weightRow = planActive ? await latestWeight(db) : null;
  const kg = weightRow?.weightKg ?? 0;
  const plan =
    planActive && kg > 0
      ? restingPlan(
          {
            sex: settingsForPlan.sex,
            birthYear: settingsForPlan.birthYear,
            heightCm: settingsForPlan.heightCm,
            activityLevel: settingsForPlan.activityLevel,
            bodyFatPct: settingsForPlan.bodyFatPct,
            waistCm: settingsForPlan.waistCm,
            bmrFactor: settingsForPlan.bmrFactor,
          },
          kg,
          settingsForPlan.goalMode,
          start,
          settingsForPlan.goalWeightKg,
          settingsForPlan.deficitTempo,
        )
      : null;
  let kcalBalanceAvg: number | null = null;
  if (plan != null && foodLogDays > 0) {
    const stepsByDay = new Map(steps.map((r) => [r.date, r]));
    const workoutKcalByDay = new Map<string, number>();
    for (const w of workoutRows) {
      workoutKcalByDay.set(w.date, (workoutKcalByDay.get(w.date) ?? 0) + (w.kcal ?? 0));
    }
    let diffSum = 0;
    for (const day of foodDays) {
      const row = stepsByDay.get(day);
      const raw = row ? Number(row.steps) : 0;
      const inWorkouts = row ? Number(row.workoutSteps ?? 0) : 0;
      const earned =
        stepsEarnedKcal(stepsOutsideWorkouts(raw, inWorkouts), kg) + (workoutKcalByDay.get(day) ?? 0);
      const target = dayBudgetKcal(plan.baseKcal, plan.minDayKcal, earned);
      diffSum += (kcalByDay.get(day) ?? 0) - target;
    }
    kcalBalanceAvg = Math.round(diffSum / foodLogDays);
  }

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
    kcalBalanceAvg,
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
