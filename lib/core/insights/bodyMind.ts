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

/// The body signals we pair against mood. `steps` is the original hero; `sleep`
/// (minutes) and `protein` (grams) ride the exact same honest machinery — added
/// in v2 without any new manual logging (steps+sleep are passive, protein comes
/// from the food log). Calories/weight are deliberately NOT here (ED safeguard,
/// Roadmap §5) — the mind axis stays mood, the body axis stays neutral signals.
export type BodyMindSignal = 'steps' | 'sleep' | 'protein';

/// One day that has BOTH a recorded body signal and at least one mood.
/// `mood` is the average of that day's moods (0–10).
export interface SignalMoodDay {
  day: string; // local 'YYYY-MM-DD'
  signal: number; // the body-signal value for the day (steps / minutes / grams)
  mood: number; // 0–10
}

/// One day that has BOTH a recorded step count and at least one diary mood.
/// `mood` is the average of that day's diary moods (0–10).
/// Kept for the original steps↔mood callers/tests; v2 uses `SignalMoodDay`.
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

/// Signal-agnostic version of `BodyMindResult` — same honesty states and guards,
/// but the direction is phrased generically ("more of the signal → better/worse
/// mood") so it works for steps, sleep and protein alike. The UI maps the
/// `signal` + `direction` onto the right localized sentence.
export type AssociationResult =
  | { kind: 'insufficient'; pairedDays: number }
  | { kind: 'no_link'; pairedDays: number }
  | {
      kind: 'link';
      pairedDays: number;
      direction: 'more_better' | 'more_worse';
      moodGap: number; // absolute gap on 0–10, one decimal
      fewerAvgMood: number; // avg mood on the lower-signal days
      moreAvgMood: number; // avg mood on the higher-signal days
    };

/// A signal paired with its association result — the unit the hero ranks over.
export interface SignalAssociation {
  signal: BodyMindSignal;
  result: AssociationResult;
}

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

/// Compares average mood between the user's lower-signal and higher-signal days
/// for ANY body signal. Pure — the caller supplies the already-paired days. This
/// is the honest core shared by every Body↔Mind pairing; the median split,
/// strict inequalities, paired-day floor and "no clear link" gap are identical
/// to the original steps↔mood read, just signal-agnostic.
export function associationInsight(points: SignalMoodDay[]): AssociationResult {
  const pairedDays = points.length;
  if (pairedDays < MIN_PAIRED_DAYS) return { kind: 'insufficient', pairedDays };

  // Split at the median signal value with strict inequalities so the two groups
  // genuinely differ; days that tie at the median fall out of both.
  const med = median(points.map((p) => p.signal));
  const fewer = points.filter((p) => p.signal < med);
  const more = points.filter((p) => p.signal > med);
  if (fewer.length < MIN_PER_BUCKET || more.length < MIN_PER_BUCKET) {
    return { kind: 'no_link', pairedDays };
  }

  const fewerAvgMood = mean(fewer.map((p) => p.mood));
  const moreAvgMood = mean(more.map((p) => p.mood));
  const gap = moreAvgMood - fewerAvgMood;
  if (Math.abs(gap) < MIN_MEANINGFUL_MOOD_GAP) {
    return { kind: 'no_link', pairedDays };
  }

  return {
    kind: 'link',
    pairedDays,
    direction: gap > 0 ? 'more_better' : 'more_worse',
    moodGap: round1(Math.abs(gap)),
    fewerAvgMood: round1(fewerAvgMood),
    moreAvgMood: round1(moreAvgMood),
  };
}

/// Compares average mood between the user's lower-step and higher-step days.
/// Pure — the caller supplies the already-paired days. Thin steps-specific
/// adapter over `associationInsight`, kept for the original hero callers/tests.
export function bodyMindInsight(points: MoodStepDay[]): BodyMindResult {
  const r = associationInsight(
    points.map((p) => ({ day: p.day, signal: p.steps, mood: p.mood })),
  );
  if (r.kind !== 'link') return r;
  return {
    kind: 'link',
    pairedDays: r.pairedDays,
    direction:
      r.direction === 'more_better' ? 'more_steps_better_mood' : 'more_steps_worse_mood',
    moodGap: r.moodGap,
    fewerStepsAvgMood: r.fewerAvgMood,
    moreStepsAvgMood: r.moreAvgMood,
  };
}

/// Picks which signal the hero should speak about, given each signal's result.
/// Preference order, all honesty guards intact:
///  1. the strongest real *link* (largest mood gap);
///  2. else an honest "no clear link yet" from whichever signal has the most
///     paired days (we have enough data to say something true);
///  3. else the "still forming" state from the signal closest to surfacing
///     (most paired days) so the building countdown reflects real progress.
/// Ties break by `order` (steps first) so the hero stays stable day to day.
export function bestAssociation(
  candidates: SignalAssociation[],
  order: BodyMindSignal[] = ['steps', 'sleep', 'protein'],
): SignalAssociation | null {
  if (candidates.length === 0) return null;
  const rank = (s: BodyMindSignal) => {
    const i = order.indexOf(s);
    return i < 0 ? order.length : i;
  };

  const links = candidates.filter((c) => c.result.kind === 'link');
  if (links.length > 0) {
    return links.reduce((best, c) => {
      const a = c.result as Extract<AssociationResult, { kind: 'link' }>;
      const b = best.result as Extract<AssociationResult, { kind: 'link' }>;
      if (a.moodGap !== b.moodGap) return a.moodGap > b.moodGap ? c : best;
      return rank(c.signal) < rank(best.signal) ? c : best;
    });
  }

  const noLinks = candidates.filter((c) => c.result.kind === 'no_link');
  const pool = noLinks.length > 0 ? noLinks : candidates;
  return pool.reduce((best, c) => {
    if (c.result.pairedDays !== best.result.pairedDays) {
      return c.result.pairedDays > best.result.pairedDays ? c : best;
    }
    return rank(c.signal) < rank(best.signal) ? c : best;
  });
}
