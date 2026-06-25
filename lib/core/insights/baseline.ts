/**
 * Personal baseline — compares today against the user's OWN recent normal,
 * not a population target. The biggest generic→personal jump on data already
 * stored: "is this high/low *for me*?"
 *
 * Pure: no DB, no i18n, deterministic. The engine is signal-agnostic (plain
 * numbers) so sleep/protein can reuse it later — but callers pass ONLY
 * steps/sleep/protein, NEVER weight or calories (ED safeguard, Roadmap §5).
 *
 * Honesty (mirrors bodyMind's "no clear difference is a real state"):
 *  - too few prior days → `forming` (learning your rhythm), never a number;
 *  - within a tolerance band of the personal median → `typical`, not a miss;
 *  - `above` / `below` only outside the band; `below` is neutral, not failure.
 */

export interface PersonalBaseline {
  kind: 'forming' | 'below' | 'typical' | 'above';
  baseline: number; // median of the prior-day window (0 when forming)
  today: number; // today's value, echoed back
  observedDays: number; // how many prior days had data
}

/// Prior days with data required before a baseline is trustworthy. Below this
/// the result is `forming` (no high/low claim yet).
export const MIN_BASELINE_DAYS = 10;

/// Relative half-width of the "typical" band around the personal median. A day
/// within ±15% of the median reads as typical, not above/below.
export const BASELINE_TOLERANCE = 0.15;

/// Absolute floor (in the signal's own units) for the band half-width, so a
/// near-zero median doesn't collapse the band to nothing and flip on tiny
/// noise. 250 suits steps; sleep/protein reuse via their own caller later.
export const BASELINE_ABS_FLOOR = 250;

/// Median of a non-empty list. Robust to the odd big/zero day (beats mean).
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Classify `today` against the median of `recent` (prior daily totals for ONE
 * signal, NOT including today). Returns a sane, non-throwing result for empty /
 * all-zero / today=0 inputs.
 */
export function personalBaseline(recent: number[], today: number): PersonalBaseline {
  const observedDays = recent.length;
  if (observedDays < MIN_BASELINE_DAYS) {
    return { kind: 'forming', baseline: 0, today, observedDays };
  }

  const baseline = median(recent);
  // Relative band with an absolute floor so near-zero baselines stay stable.
  const band = Math.max(baseline * BASELINE_TOLERANCE, BASELINE_ABS_FLOOR);

  let kind: PersonalBaseline['kind'];
  if (today > baseline + band) kind = 'above';
  else if (today < baseline - band) kind = 'below';
  else kind = 'typical';

  return { kind, baseline, today, observedDays };
}
