/// Reading a logged workout back — «Силовая · 12 подх. · с часов» plus its
/// burn. Lives here (pure, `t` injected) rather than inside a screen because a
/// past session must read exactly like today's did on «Тренировки сегодня»:
/// same order, same tags, same «≈». Mirrors [formatDay] — hand-rolled, testable
/// without a renderer.

type Translate = (key: string, opts?: Record<string, unknown>) => string;

/// The parts of a workout row a line needs. Structurally typed so a `WorkoutRow`
/// off the db and a plain test fixture both fit without a cast.
export interface WorkoutLineInput {
  type: string;
  label?: string | null;
  minutes: number;
  sets?: number | null;
  speedKmh?: number | null;
  intensity?: string | null;
  source?: string | null;
  kcal: number;
  kcalFrom?: string | null;
}

/// One line describing the session: what it was, then how much of it, then how
/// hard, then where it came from. The user's own words (`label`, from the
/// free-text/voice parse) win over the type name — «20 приседаний» is what they
/// entered, and that is what the history has to say back to them.
export function formatWorkoutLine(w: WorkoutLineInput, t: Translate): string {
  const label = w.label?.trim();
  const parts = [label && label.length > 0 ? label : t(`workouts.type.${w.type}`)];
  if (w.sets != null && w.sets > 0) parts.push(t('workouts.setsCount', { count: w.sets }));
  // Skip a «0 мин» tail: a «по трекеру» entry has kcal but no duration.
  else if (w.minutes > 0) parts.push(`${w.minutes} ${t('workouts.min')}`);
  if (w.speedKmh) parts.push(`${Math.round(w.speedKmh * 10) / 10} ${t('workouts.kmh')}`);
  if (w.intensity) parts.push(t(`workouts.intensity.${w.intensity}`));
  // Provenance tag for auto-imported sessions — «с часов».
  if (w.source === 'device') parts.push(t('workouts.fromDevice'));
  return parts.join(' · ');
}

/// Workout energy is an app estimate above resting expenditure.
const ESTIMATE_PREFIX = '≈ ';

/// Show one estimated value when the workout has an energy estimate.
export function formatWorkoutValue(
  w: WorkoutLineInput,
  t: Translate,
  hideCalories: boolean,
): string | null {
  if (hideCalories || (w.source === 'tracker' && w.minutes <= 0)) return null;
  return `${ESTIMATE_PREFIX}${budgetKcal(w.kcal)} ${t('units.kcal')}`;
}

/// Whole active calories credited to the day.
export function budgetKcal(rawKcal: number): number {
  return Math.round(Math.max(0, rawKcal));
}
