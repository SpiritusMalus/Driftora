/**
 * Comparative stats done honestly (Roadmap §6): place the user's weekly step
 * average against **sourced evidence reference points**, NOT a peer leaderboard.
 *
 * Sources (same evidence base as `stepInsight`):
 *  - ~7,000 steps/day is where major risk reductions appear vs ~2,000 (all-cause
 *    mortality, CVD, dementia, falls). Lancet Public Health 2025.
 *  - The "10,000" target is a marketing number, not a medical threshold.
 *  - The benefit plateau is age-dependent (2022 15-cohort meta-analysis) —
 *    handled by `plateauFor`.
 *
 * Off by default in the app (opt-in setting) because social comparison can
 * demotivate (Roadmap §5); this stays informational + achievable-framed, never
 * competitive. Pure — the UI composes the sourced sentence from the result.
 */

import { plateauFor } from './stepInsight';

/// Steps/day where major risk reductions appear (Lancet Public Health 2025).
export const STEP_BENEFICIAL = 7000;

export type StepStanding = 'building' | 'approaching' | 'beneficial' | 'ample';

/// Where a weekly average sits relative to the evidence reference points.
export function stepStanding(weeklyAvg: number, ageYears?: number): StepStanding {
  if (weeklyAvg >= plateauFor(ageYears)) return 'ample';
  if (weeklyAvg >= STEP_BENEFICIAL) return 'beneficial';
  if (weeklyAvg >= 5000) return 'approaching';
  return 'building';
}

export interface StepReference {
  weeklyAvg: number;
  beneficial: number;
  standing: StepStanding;
  /// Steps/day still to reach the beneficial reference — an achievable next
  /// step, never a "you're behind" framing. 0 once already there.
  gapToBeneficial: number;
}

/// Builds the comparison, or null if there's no step average to compare yet.
export function stepReference(weeklyAvg: number, ageYears?: number): StepReference | null {
  if (weeklyAvg <= 0) return null;
  return {
    weeklyAvg,
    beneficial: STEP_BENEFICIAL,
    standing: stepStanding(weeklyAvg, ageYears),
    gapToBeneficial: Math.max(0, STEP_BENEFICIAL - weeklyAvg),
  };
}
