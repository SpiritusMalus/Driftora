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

/// One honest sentence (Russian) about what today's steps mean, framed against
/// the user's personal `goal` (not a universal target).
export function stepInsight(steps: number, goal: number, ageYears?: number): string {
  switch (stepBand(steps, ageYears)) {
    case 'none':
      return 'Сегодня шагов пока нет — даже короткая прогулка уже в плюс.';
    case 'low':
      return 'Совсем немного движения. Небольшая прогулка ощутимо снизит риски для сердца и поможет нервной системе.';
    case 'building':
      return 'Хорошее начало. Ближе к 5–7 тысячам шагов польза для сердца, сосудов и настроения растёт быстрее всего.';
    case 'beneficial':
      return steps >= goal
        ? 'Личная цель на сегодня достигнута — это уже заметная поддержка сердца, мозга и стрессоустойчивости.'
        : 'Вы в зоне, где польза растёт быстрее всего: каждый шаг к ~7 тысячам заметно снижает риски и уровень кортизола.';
    case 'ample':
      return 'Отличный объём ходьбы — для здоровья этого более чем достаточно. Больше шагов уже не обязательно «лучше».';
  }
}
