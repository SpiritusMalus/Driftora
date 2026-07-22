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

/// EVERY workout burn carries «≈», including the ones that came off a watch.
///
/// This used to discriminate: our MET math got the tilde, a device's own number
/// was printed bare as a measurement. The validation literature does not support
/// that hierarchy. Against laboratory indirect calorimetry, wrist wearables'
/// ENERGY estimates miss by more than 30% MAPE for every one of 29 brands tested
/// (systematic review, 65 studies, 72 devices); Apple Watch specifically spans
/// 15%–211% across studies, with the worst errors on walking (up to 152% MAPE)
/// and the best on running. A separate controlled lab study (n=60, continuous
/// indirect calorimetry) found no device under 20% median error — Apple Watch
/// was best of seven and still failed that bar. The error has no consistent
/// direction, so it cannot be corrected away with a factor either.
///
/// Meanwhile those same devices measure heart rate to within ~2% and steps to
/// within ~25%. The sensors are fine; the calorie MODEL on top of them is not —
/// which is exactly the thing we would have been deferring to. So the tilde now
/// says the true thing about all of them: nobody here is measuring your
/// calories, us included. Provenance is still shown («с часов», «по трекеру»),
/// so the user can tell whose estimate it is.
const ESTIMATE_PREFIX = '≈ ';

/// The burn shown beside the line — or null under «Скрыть калории», where the
/// row simply loses its trailing number: the duration already rides in the line
/// above, so the session stays visible and nothing is faked to fill the space.
export function formatWorkoutValue(
  w: WorkoutLineInput,
  t: Translate,
  hideCalories: boolean,
): string | null {
  if (hideCalories) return null;
  return `${ESTIMATE_PREFIX}${Math.round(w.kcal)} ${t('units.kcal')}`;
}
