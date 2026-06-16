/**
 * Body ↔ Mind: an honest, non-causal read on whether the user's mood tends to
 * run higher on days they move more.
 *
 * This is the app's signature "two domains in one" insight: it pairs each day's
 * diary mood (0–10) with that day's step count and reports, in one gentle line,
 * how average mood compares between the user's lower-step and higher-step days.
 *
 * Honesty rules (this is health data about a real person — do not overclaim):
 *  - It is an *association*, never a cause. The copy must say so; we never imply
 *    "walk more to feel better".
 *  - Show nothing until there are enough paired days (`MIN_PAIRED_DAYS`) — a
 *    couple of points is noise, and a confident-looking number on noise is worse
 *    than silence.
 *  - Treat a small gap (< `MIN_MEANINGFUL_MOOD_GAP` on the 0–10 scale) as "no
 *    clear link", not as a finding.
 *  - The two buckets are split at the *median* step count with strict
 *    inequalities, so days that tie at the median are dropped and the buckets
 *    genuinely differ in steps — otherwise a mood gap could not be about steps
 *    at all.
 *
 * Pure: no DB, no i18n. The DB layer gathers the paired days
 * (`lib/core/db/bodyMind.ts`) and the UI turns the structured result into a
 * localized sentence (same split-of-concerns as `autoWins`).
 */

/// One day that has BOTH a recorded step count and at least one diary mood.
/// `mood` is the average of that day's diary moods (0–10).
export interface MoodStepDay {
  day: string; // local 'YYYY-MM-DD'
  steps: number;
  mood: number; // 0–10
}

/// Fewest paired days before we say anything at all. Deliberately conservative
/// but reachable — below this it is noise. (Tune here if it proves too slow.)
export const MIN_PAIRED_DAYS = 6;

/// Each side of the median split needs at least this many days, or the split is
/// too lopsided (e.g. many days tie at the median) to read.
export const MIN_PER_BUCKET = 3;

/// A mood gap smaller than this (on the 0–10 scale) is treated as "no link"
/// rather than dressed up as a finding.
export const MIN_MEANINGFUL_MOOD_GAP = 0.5;

export type BodyMindResult =
  /// Not enough paired days yet — show nothing.
  | { kind: 'insufficient'; pairedDays: number }
  /// Enough data, but no meaningful difference (or steps don't separate) — an
  /// honest "nothing clear yet" is itself worth showing.
  | { kind: 'no_link'; pairedDays: number }
  /// A noteworthy association between moving more and mood.
  | {
      kind: 'link';
      pairedDays: number;
      // 'more_steps_better_mood' = higher-step days had higher average mood.
      direction: 'more_steps_better_mood' | 'more_steps_worse_mood';
      moodGap: number; // absolute gap on 0–10, one decimal
      fewerStepsAvgMood: number;
      moreStepsAvgMood: number;
    };

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/// Compares average mood between the user's lower-step and higher-step days.
/// Pure — the caller supplies the already-paired days.
export function bodyMindInsight(points: MoodStepDay[]): BodyMindResult {
  const pairedDays = points.length;
  if (pairedDays < MIN_PAIRED_DAYS) return { kind: 'insufficient', pairedDays };

  // Split at the median step count with strict inequalities so the two groups
  // genuinely differ in steps; days that tie at the median fall out of both.
  const med = median(points.map((p) => p.steps));
  const fewer = points.filter((p) => p.steps < med);
  const more = points.filter((p) => p.steps > med);
  if (fewer.length < MIN_PER_BUCKET || more.length < MIN_PER_BUCKET) {
    return { kind: 'no_link', pairedDays };
  }

  const fewerStepsAvgMood = mean(fewer.map((p) => p.mood));
  const moreStepsAvgMood = mean(more.map((p) => p.mood));
  const gap = moreStepsAvgMood - fewerStepsAvgMood;
  if (Math.abs(gap) < MIN_MEANINGFUL_MOOD_GAP) {
    return { kind: 'no_link', pairedDays };
  }

  return {
    kind: 'link',
    pairedDays,
    direction: gap > 0 ? 'more_steps_better_mood' : 'more_steps_worse_mood',
    moodGap: round1(Math.abs(gap)),
    fewerStepsAvgMood: round1(fewerStepsAvgMood),
    moreStepsAvgMood: round1(moreStepsAvgMood),
  };
}
