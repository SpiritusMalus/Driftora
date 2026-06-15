/// Honest, sourced "what your steps mean" copy.
///
/// Evidence (do NOT ship the "10,000 steps" myth — it's a marketing number,
/// not a medical threshold):
///   * ~7,000 steps/day is associated with a 6–47% lower risk across all-cause
///     mortality, CVD, dementia and falls vs ~2,000 steps; the inflection sits
///     around ~5,000–7,000. (Lancet Public Health 2025 dose-response meta-analysis.)
///   * The plateau is age-dependent: <60y benefit up to ~8,000–10,000, 60+ up to
///     ~6,000–8,000. (2022 15-cohort meta-analysis, PMC9289978.)
///   * Walking also raises parasympathetic activity, regulates the HPA axis and
///     lowers cortisol, lifting mood. (PMC11594215.)
///
/// We translate the count into ONE short, non-judgmental sentence and never
/// imply that "more is always better".
library;

/// Evidence-based bands for a daily step count.
enum StepBand { none, low, building, beneficial, ample }

/// The step count above which extra walking stops adding meaningful risk
/// reduction — earlier for older adults.
int plateauFor({int? ageYears}) =>
    (ageYears != null && ageYears >= 60) ? 7000 : 9000;

/// Classifies [steps] into an evidence-based [StepBand].
StepBand stepBand(int steps, {int? ageYears}) {
  if (steps <= 0) return StepBand.none;
  if (steps < 2000) return StepBand.low;
  if (steps < 5000) return StepBand.building;
  if (steps >= plateauFor(ageYears: ageYears)) return StepBand.ample;
  return StepBand.beneficial;
}

/// One honest sentence (Russian) about what today's [steps] mean, framed
/// against the user's personal [goal] (not a universal target).
String stepInsight({required int steps, required int goal, int? ageYears}) {
  switch (stepBand(steps, ageYears: ageYears)) {
    case StepBand.none:
      return 'Сегодня шагов пока нет — даже короткая прогулка уже в плюс.';
    case StepBand.low:
      return 'Совсем немного движения. Небольшая прогулка ощутимо снизит риски '
          'для сердца и поможет нервной системе.';
    case StepBand.building:
      return 'Хорошее начало. Ближе к 5–7 тысячам шагов польза для сердца, '
          'сосудов и настроения растёт быстрее всего.';
    case StepBand.beneficial:
      final reachedGoal = steps >= goal;
      return reachedGoal
          ? 'Личная цель на сегодня достигнута — это уже заметная поддержка '
                'сердца, мозга и стрессоустойчивости.'
          : 'Вы в зоне, где польза растёт быстрее всего: каждый шаг к ~7 тысячам '
                'заметно снижает риски и снижает уровень кортизола.';
    case StepBand.ample:
      return 'Отличный объём ходьбы — для здоровья этого более чем достаточно. '
          'Больше шагов уже не обязательно «лучше».';
  }
}
