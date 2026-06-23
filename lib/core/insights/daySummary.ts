/**
 * "Your day in one line" (B2): one warm sentence at the top of Home that sums
 * the day from data the app already has — today's steps, the latest mood, and
 * whether a win was earned — so the user doesn't have to parse a stack of cards.
 *
 * Tone (Roadmap §5, anti-shame): it celebrates what happened and is gentle when
 * nothing has yet; it NEVER scolds a missed day. Pure: it returns an i18n key +
 * params, the UI composes the localized sentence (translation-free, same split
 * as `stepInsight`/`autoWins`).
 */

export interface DaySummaryFacts {
  steps: number | null; // today's steps, or null if not synced
  mood: number | null; // latest mood today (0–10), or null
  hasWinToday: boolean; // any win (auto or manual) logged today
}

/// An i18n key suffix under `home.daySummary.*` plus the values to interpolate.
export interface DaySummary {
  key: string;
  steps?: number;
  mood?: number;
}

/// Picks the warm one-liner template that matches what today actually holds.
/// Pure — no I/O, no i18n. `steps` counts only when present and > 0 (a synced
/// zero is "no walk yet", handled by the gentler templates).
export function daySummary(facts: DaySummaryFacts): DaySummary {
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

  return { key, steps, mood };
}
