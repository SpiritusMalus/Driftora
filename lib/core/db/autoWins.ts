import { and, eq, gte, lt } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { dayBounds } from './food';
import { wins } from './schema';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests). Query builders are awaitable for both.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// Stable `kind` tags for auto-awarded wins, namespaced so they never collide
/// with the 'manual' kind and can be deduped per day.
export const AUTO_WIN_STEPS_GOAL = 'auto:steps_goal';
export const AUTO_WIN_PROTEIN_GOAL = 'auto:protein_goal';

/// Today's facts the auto-win rules look at. Goals/targets of 0 mean "not set"
/// and never earn a win (so a fresh, ungoaled profile gets no false wins).
export interface AutoWinFacts {
  steps: number;
  stepsGoal: number;
  proteinG: number;
  proteinTargetG: number;
  /// "Take a break" mode — when true, no auto-wins fire (no pressure on a pause).
  paused?: boolean;
}

/// Localized win messages the caller supplies — the db layer stays i18n-free.
export interface AutoWinMessages {
  stepsGoal: string;
  proteinGoal: string;
}

/// Which auto-win kinds the facts qualify for right now, before dedup. Pure —
/// no DB. Deliberately rewards reaching a *protein* goal (a habit you want more
/// of), never a calorie cap, to avoid the "limit reached" diet-pressure pattern.
export function earnedAutoWinKinds(facts: AutoWinFacts): string[] {
  if (facts.paused) return []; // on a break: no goals, no pressure
  const kinds: string[] = [];
  if (facts.stepsGoal > 0 && facts.steps >= facts.stepsGoal) {
    kinds.push(AUTO_WIN_STEPS_GOAL);
  }
  if (facts.proteinTargetG > 0 && facts.proteinG >= facts.proteinTargetG) {
    kinds.push(AUTO_WIN_PROTEIN_GOAL);
  }
  return kinds;
}

/// True if a win of [kind] already exists on [date]'s local day.
export async function hasWinOfKindOnDay(
  db: AnyDb,
  kind: string,
  date: Date = new Date(),
): Promise<boolean> {
  const { start, end } = dayBounds(date);
  const rows = await db
    .select({ id: wins.id })
    .from(wins)
    .where(and(eq(wins.kind, kind), gte(wins.ts, start), lt(wins.ts, end)));
  return rows.length > 0;
}

/// True if ANY win (auto or manual) was logged on [date]'s local day — the
/// "you earned something today" signal for the Home day-summary line.
export async function hasAnyWinOnDay(
  db: AnyDb,
  date: Date = new Date(),
): Promise<boolean> {
  const { start, end } = dayBounds(date);
  const rows = await db
    .select({ id: wins.id })
    .from(wins)
    .where(and(gte(wins.ts, start), lt(wins.ts, end)));
  return rows.length > 0;
}

/// Inserts a win of [kind] unless one already exists on [date]'s local day.
/// Returns true iff a new win was written — idempotent per (kind, day), so it
/// is safe to call on every Home focus.
export async function awardOncePerDay(
  db: AnyDb,
  kind: string,
  message: string,
  date: Date = new Date(),
): Promise<boolean> {
  if (await hasWinOfKindOnDay(db, kind, date)) return false;
  await db.insert(wins).values({ kind, message, ts: date });
  return true;
}

/// Evaluates today's facts and awards any earned auto-wins, deduped per day.
/// Returns the kinds newly written (so the caller can refresh / celebrate).
export async function runAutoWins(
  db: AnyDb,
  facts: AutoWinFacts,
  messages: AutoWinMessages,
  date: Date = new Date(),
): Promise<string[]> {
  const awarded: string[] = [];
  for (const kind of earnedAutoWinKinds(facts)) {
    const message = kind === AUTO_WIN_STEPS_GOAL ? messages.stepsGoal : messages.proteinGoal;
    if (await awardOncePerDay(db, kind, message, date)) awarded.push(kind);
  }
  return awarded;
}
