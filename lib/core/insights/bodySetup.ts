import { validBodyFatPct, validWaistCm, type GoalMode } from './bodyMetrics';

/// Pure flow logic of the body-setup wizard («Настройка тела»): the ordered
/// step list and the per-field plausibility checks. The wizard asks ONE thing
/// per screen and persists everything in a single write on «Рассчитать
/// суточную норму» — the antidote to the old form that autosaved every field.
/// Kept out of the component so the sequencing/validation is unit-testable.

export type SetupStep =
  | 'birthYear'
  | 'sex'
  | 'height'
  | 'weight'
  | 'bodyFat'
  | 'waist'
  | 'goal'
  | 'goalWeight'
  | 'tempo'
  | 'result';

/// Ordered steps for a chosen goal. Maintain has no destination weight and no
/// pace, so those steps vanish for it instead of showing up disabled. The waist
/// step follows bodyFat: it's the device-free composition input (a tape, no
/// scale) and — since most people don't know their measured % — is usually the
/// one that actually lifts the estimate off population-average Mifflin. Both are
/// optional (skippable).
export function setupSteps(goal: GoalMode): SetupStep[] {
  const base: SetupStep[] = ['birthYear', 'sex', 'height', 'weight', 'bodyFat', 'waist', 'goal'];
  return goal === 'maintain' ? [...base, 'result'] : [...base, 'goalWeight', 'tempo', 'result'];
}

// The bands below mirror suggestPlan's gates exactly — the wizard's job is to
// stop implausible input BEFORE the engine would silently return null.

/// A year giving an age of 14–100 at `now`.
export function birthYearValid(year: number, now: Date = new Date()): boolean {
  if (!Number.isFinite(year)) return false;
  const age = now.getFullYear() - year;
  return age >= 14 && age <= 100;
}

export function heightValid(cm: number): boolean {
  return Number.isFinite(cm) && cm >= 100 && cm <= 250;
}

export function weightValid(kg: number): boolean {
  return Number.isFinite(kg) && kg >= 20 && kg <= 400;
}

/// Body fat is OPTIONAL: 0 = "not provided" is always fine (the plan stays on
/// Mifflin); a provided value must sit in the plausible measured band.
export function bodyFatValid(pct: number): boolean {
  return pct === 0 || validBodyFatPct(pct);
}

/// Waist is OPTIONAL: 0 = "not provided" is always fine; a provided value must
/// sit in the plausible adult band (drives the RFM body-fat estimate).
export function waistValid(cm: number): boolean {
  return cm === 0 || validWaistCm(cm);
}

/// Goal weight is OPTIONAL (0 = skipped), but a provided one must be plausible
/// and point where the goal goes — «похудеть» to a heavier number is a typo,
/// not a plan.
export function goalWeightValid(kg: number, currentKg: number, goal: GoalMode): boolean {
  if (goal === 'maintain' || kg === 0) return true;
  if (!(Number.isFinite(kg) && kg >= 20 && kg <= 400)) return false;
  return goal === 'lose' ? kg < currentKg : kg > currentKg;
}
