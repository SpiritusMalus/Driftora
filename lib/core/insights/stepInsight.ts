/**
 * Honest, sourced "what your steps mean" copy.
 *
 * Evidence (do NOT ship the "10,000 steps" myth — it's a marketing number, not
 * a medical threshold):
 *  - ~7,000 steps/day is associated with 6–47% lower risk across all-cause
 *    mortality, CVD, dementia and falls vs ~2,000; inflection ~5,000–7,000.
 *    (Lancet Public Health 2025 dose-response meta-analysis.)
 *  - Plateau is age-dependent: <60y up to ~8,000–10,000, 60+ up to ~6,000–8,000.
 *    (2022 15-cohort meta-analysis, PMC9289978.)
 *  - Walking raises parasympathetic activity, regulates the HPA axis, lowers
 *    cortisol and lifts mood. (PMC11594215.)
 *
 * We output ONE short, non-judgmental sentence and never imply "more is better".
 */

export type StepBand = 'none' | 'low' | 'building' | 'beneficial' | 'ample';

/// Step count above which extra walking stops adding meaningful risk reduction.
export function plateauFor(ageYears?: number): number {
  return ageYears != null && ageYears >= 60 ? 7000 : 9000;
}

/// Classifies a daily step count into an evidence-based band.
export function stepBand(steps: number, ageYears?: number): StepBand {
  if (steps <= 0) return 'none';
  if (steps < 2000) return 'low';
  if (steps < 5000) return 'building';
  if (steps >= plateauFor(ageYears)) return 'ample';
  return 'beneficial';
}

/// One honest sentence about what today's steps mean, framed against the
/// user's personal `goal` (not a universal target). Returns an i18n key under
/// `insights.steps.*` — render with t() (the daySummary convention: the module
/// stays pure, the words live in the locale files).
export function stepInsight(steps: number, goal: number, ageYears?: number): string {
  switch (stepBand(steps, ageYears)) {
    case 'none':
      return 'insights.steps.none';
    case 'low':
      return 'insights.steps.low';
    case 'building':
      return 'insights.steps.building';
    case 'beneficial':
      return steps >= goal ? 'insights.steps.goalMet' : 'insights.steps.beneficial';
    case 'ample':
      return 'insights.steps.ample';
  }
}
