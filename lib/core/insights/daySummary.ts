/**
 * "Your day in one line" (B2): one warm sentence at the top of Home that sums
 * the day from data the app already has — today's steps, the latest mood, and
 * whether a win was earned — so the user doesn't have to parse a stack of cards.
 *
 * Tone (Roadmap §5, anti-shame): it celebrates what happened and is gentle when
 * nothing has yet; it NEVER scolds a missed day. Pure: it returns an i18n key +
 * params, the UI composes the localized sentence (translation-free, same split
 * as `stepInsight`/`autoWins`).
 *
 * B3 (forgiving re-engagement): when the user comes back after a gap and hasn't
 * logged anything yet today, the otherwise-`empty` line becomes a warm "welcome
 * back" that rewards the *return* — never "you missed N days". One of a few
 * rotating variants, picked deterministically.
 */

import { pickVariant } from './variant';

export interface DaySummaryFacts {
  steps: number | null; // today's steps, or null if not synced
  mood: number | null; // latest mood today (0–10), or null
  hasWinToday: boolean; // any win (auto or manual) logged today
  // Calendar days since the most recent day with ANY activity (excluding
  // today), or null when there's no prior history / it's not known. Drives the
  // forgiving "welcome back" line — see `daysSince`.
  daysSinceLastActivity?: number | null;
}

/// A gap of this many calendar days (or more) since the last activity flips the
/// empty state into the warm "welcome back" line. 1 day (yesterday) is not a
/// gap; 2+ is a real return worth rewarding.
export const RETURNING_AFTER_DAYS = 2;

/// The rotating "welcome back" key suffixes under `home.daySummary.*`. Picked
/// deterministically by `seed` so the line is stable within a day but varies
/// across returns. Every variant rewards the return — zero shame by rule.
export const RETURNING_KEYS = ['returning1', 'returning2', 'returning3', 'returning4'] as const;

/// Calendar days between the last activity and `now`, ignoring clock time (a
/// gap is counted in whole local days). `null` in → `null` out (no history).
/// Never negative.
export function daysSince(lastActivity: Date | null, now: Date = new Date()): number | null {
  if (lastActivity == null) return null;
  const last = Date.UTC(lastActivity.getFullYear(), lastActivity.getMonth(), lastActivity.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today - last) / 86_400_000));
}

/// An i18n key suffix under `home.daySummary.*` plus the values to interpolate.
export interface DaySummary {
  key: string;
  steps?: number;
  mood?: number;
}

/// Picks the warm one-liner template that matches what today actually holds.
/// Pure — no I/O, no i18n. `steps` counts only when present and > 0 (a synced
/// zero is "no walk yet", handled by the gentler templates). `seed` rotates the
/// "welcome back" variant deterministically (default reproduces variant 0).
export function daySummary(facts: DaySummaryFacts, seed = 0): DaySummary {
  const hasSteps = facts.steps != null && facts.steps > 0;
  const hasMood = facts.mood != null;
  const hasWin = facts.hasWinToday;
  const steps = hasSteps ? facts.steps! : undefined;
  const mood = hasMood ? facts.mood! : undefined;

  // Eight combinations → one stable key each. `empty` is the calm "nothing yet".
  let key: string;
  if (hasSteps && hasMood && hasWin) key = 'stepsMoodWin';
  else if (hasSteps && hasMood) key = 'stepsMood';
  else if (hasSteps && hasWin) key = 'stepsWin';
  else if (hasMood && hasWin) key = 'moodWin';
  else if (hasSteps) key = 'steps';
  else if (hasMood) key = 'mood';
  else if (hasWin) key = 'win';
  else key = 'empty';

  // Forgiving re-engagement (B3): nothing logged yet today AND they were away a
  // real gap → reward the return instead of the generic empty calm. Returning
  // wins only over `empty` — a logged day keeps its own celebratory line.
  const gap = facts.daysSinceLastActivity;
  if (key === 'empty' && gap != null && gap >= RETURNING_AFTER_DAYS) {
    key = pickVariant(RETURNING_KEYS, seed);
  }

  return { key, steps, mood };
}
