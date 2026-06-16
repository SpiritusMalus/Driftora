/**
 * Engagement signals computed from the set of self-initiated log days — the
 * north-star metric and a *forgiving* streak.
 *
 * Design (Roadmap §1, §5; Ideas §3, §4):
 *  - North-star = days/week with ≥1 self-initiated log. A process metric, not
 *    weight or a calorie deficit — it can't push disordered behavior.
 *  - The streak is **weekly, not daily**: a week counts as long as it has at
 *    least one log day. A single missed day never breaks it, and the current
 *    (in-progress) week never breaks it before it's over — so the app never
 *    shames a quiet day.
 *
 * Pure: operates on a `Set<string>` of 'YYYY-MM-DD' keys (built by the db layer
 * via `dayKey`) and a reference `today`. Mirrors `dayKey`'s local-day format.
 */

import { dayKey } from '../db/steps';

/// A week qualifies for the streak with at least this many self-initiated log
/// days. One is intentionally forgiving — showing up once keeps the chain.
export const WEEKLY_STREAK_MIN_DAYS = 1;

export interface WeeklyStreak {
  /// Consecutive qualifying weeks up to and including the current one.
  weeks: number;
  /// Self-initiated log days so far in the current (Mon–Sun) week.
  currentWeekDays: number;
  /// Whether the current week already qualifies (≥ minDays logged).
  currentWeekQualified: boolean;
}

/// Monday 00:00 (local) of the week containing [date].
function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const mondayOffset = (d.getDay() + 6) % 7; // Sun=6, Mon=0 … Sat=5
  d.setDate(d.getDate() - mondayOffset);
  return d;
}

/// How many of the 7 days starting at [weekStart] are in [logDays].
function logDaysInWeek(logDays: Set<string>, weekStart: Date): number {
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    if (logDays.has(dayKey(d))) n += 1;
  }
  return n;
}

/// Distinct self-initiated log days within the local [start, end) window — the
/// north-star reading for a given week.
export function logDaysInRange(logDays: Set<string>, start: Date, end: Date): number {
  let n = 0;
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (d < end) {
    if (logDays.has(dayKey(d))) n += 1;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

/// The forgiving weekly streak as of [today]. The current week is only added
/// once it qualifies, but a not-yet-qualifying current week does NOT break the
/// chain — it just leaves the prior consecutive qualifying weeks standing.
export function weeklyStreak(
  logDays: Set<string>,
  today: Date,
  minDaysPerWeek: number = WEEKLY_STREAK_MIN_DAYS,
): WeeklyStreak {
  const currentWeekStart = startOfWeek(today);
  const currentWeekDays = logDaysInWeek(logDays, currentWeekStart);
  const currentWeekQualified = currentWeekDays >= minDaysPerWeek;

  let weeks = currentWeekQualified ? 1 : 0;
  const cursor = new Date(currentWeekStart);
  cursor.setDate(cursor.getDate() - 7); // step back to the previous week
  while (logDaysInWeek(logDays, cursor) >= minDaysPerWeek) {
    weeks += 1;
    cursor.setDate(cursor.getDate() - 7);
  }

  return { weeks, currentWeekDays, currentWeekQualified };
}
