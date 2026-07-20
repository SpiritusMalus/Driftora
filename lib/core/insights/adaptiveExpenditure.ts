/// Adaptive expenditure: your REAL daily energy burn, measured from your own
/// weight trend and food log — no bioimpedance scale, no formula guess. This is
/// the device-free "measurement" the app can actually offer, and after a few
/// weeks of consistent logging it beats any predictive equation (Mifflin/Katch)
/// by 2–3× in published comparisons, because it reads the body's real energy
/// balance instead of estimating it.
///
/// The physics is a rearranged energy-balance equation:
///     intake − Δ(stored energy) = expenditure
/// Δ(stored energy) per day = (weight change per day) × ~7700 kcal per kg. So if
/// you ate ~2000 kcal/day and lost 0.1 kg/day, you burned 2000 − (−770) = 2770.
///
/// Pure and offline like every insights module. The two honesty guards that keep
/// this from lying: (1) intake is averaged over the days you ACTUALLY logged, and
/// we only surface a result once coverage is high enough that the unlogged days
/// can be assumed similar — under-logging otherwise drags the estimate low; and
/// (2) the weight trend is a least-squares slope over several weigh-ins, so one
/// water-weight spike doesn't swing it. Below the gates we return null (say «not
/// enough data yet»), never a confident wrong number.

import { ACTIVITY_FACTORS, EATBACK_FRACTION, stepsEarnedKcal, stepsOutsideWorkouts } from './bodyMetrics';

/// ≈7,700 kcal stored per kg of body-mass change (the same constant the pace
/// math uses in bodyMetrics — kept local so this module stays self-contained).
const KCAL_PER_KG = 7700;

/// A day's logged food energy. `kcal` is the day's total; days with no log are
/// simply absent from the array (not zero rows).
export interface IntakeDay {
  date: string; // 'YYYY-MM-DD' local
  kcal: number;
}

/// A weigh-in on a given day.
export interface WeightPoint {
  date: string; // 'YYYY-MM-DD' local
  kg: number;
}

/// How solid the estimate is — drives whether the UI leads with it or hedges.
export type ExpenditureConfidence = 'ok' | 'good';

export interface MeasuredExpenditure {
  /// The measured daily energy burn, rounded to 10 kcal. This is a TOTAL
  /// expenditure (it already includes the activity of those days), NOT a resting
  /// BMR — don't add steps/workouts on top of it.
  kcalPerDay: number;
  /// Mean intake over the logged days, rounded — shown so the number is auditable.
  avgIntakeKcal: number;
  /// Signed weight trend over the window, kg per week (− losing, + gaining),
  /// rounded to 0.05 kg. The visible «почему»: expenditure = intake − this.
  weightSlopeKgPerWeek: number;
  /// Days in the window that had a food log (coverage).
  daysCovered: number;
  /// Span between the first and last weigh-in used, in days.
  weightSpanDays: number;
  /// Weigh-ins used.
  weighIns: number;
  confidence: ExpenditureConfidence;
}

/// The trailing window (days) the estimate reads. Two weeks is the shortest span
/// that averages out day-to-day water/glycogen noise while staying current.
export const ADAPTIVE_WINDOW_DAYS = 14;

// Gates below the estimate is not shown at all (honest «рано считать»).
const MIN_FOOD_DAYS = 8; // coverage: enough logged days to trust the intake avg
const MIN_WEIGH_INS = 2; // need at least a start and an end to have a trend
const MIN_WEIGHT_SPAN_DAYS = 7; // a trend over <1 week is mostly water noise
// Coverage/quality thresholds for the higher «good» confidence.
const GOOD_FOOD_DAYS = 12;
const GOOD_WEIGH_INS = 4;
const GOOD_SPAN_DAYS = 11;
// Sanity clamp — a data glitch (a mis-typed 20 000 kcal, a 10 kg scale jump)
// must not surface an absurd expenditure. Adult daily burn lives well inside.
const MIN_PLAUSIBLE = 800;
const MAX_PLAUSIBLE = 6000;

/// Local 'YYYY-MM-DD' → a day index (days since epoch), for span + regression.
function dayIndex(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(t)) return null;
  return Math.round(t / 86_400_000);
}

/// Least-squares slope (kg per day) of weight over the weigh-ins. Falls back to
/// the simple first→last slope for exactly two points (where regression is the
/// same line anyway). Returns null if the points don't span any time.
function weightSlopeKgPerDay(points: { x: number; kg: number }[]): number | null {
  const n = points.length;
  if (n < 2) return null;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.kg, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    num += dx * (p.kg - meanY);
    den += dx * dx;
  }
  if (den === 0) return null; // all on the same day
  return num / den;
}

/// Measure daily expenditure from the last [windowDays] of intake + weigh-ins.
/// Returns null when there isn't enough consistent data to be honest about it.
/// `now` is the window's end (inclusive); the window is [now−(windowDays−1) … now].
export function measuredExpenditure(
  intake: IntakeDay[],
  weights: WeightPoint[],
  now: Date = new Date(),
  windowDays: number = ADAPTIVE_WINDOW_DAYS,
): MeasuredExpenditure | null {
  const endIdx = dayIndex(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
  );
  if (endIdx == null) return null;
  const startIdx = endIdx - (windowDays - 1);

  // Intake: keep in-window logged days with a plausible positive total.
  const foodDays: number[] = [];
  for (const d of intake) {
    const x = dayIndex(d.date);
    if (x == null || x < startIdx || x > endIdx) continue;
    if (!Number.isFinite(d.kcal) || d.kcal <= 0) continue;
    foodDays.push(d.kcal);
  }
  if (foodDays.length < MIN_FOOD_DAYS) return null;

  // Weigh-ins: in-window, plausible, de-duplicated to one per day (last wins is
  // irrelevant here — we only regress the values), sorted by day.
  const pts = new Map<number, number>();
  for (const w of weights) {
    const x = dayIndex(w.date);
    if (x == null || x < startIdx || x > endIdx) continue;
    if (!Number.isFinite(w.kg) || w.kg < 20 || w.kg > 400) continue;
    pts.set(x, w.kg);
  }
  if (pts.size < MIN_WEIGH_INS) return null;
  const sorted = [...pts.entries()].map(([x, kg]) => ({ x, kg })).sort((a, b) => a.x - b.x);
  const weightSpanDays = sorted[sorted.length - 1].x - sorted[0].x;
  if (weightSpanDays < MIN_WEIGHT_SPAN_DAYS) return null;

  const slopePerDay = weightSlopeKgPerDay(sorted);
  if (slopePerDay == null) return null;

  const avgIntake = foodDays.reduce((s, k) => s + k, 0) / foodDays.length;
  const deltaEnergyPerDay = slopePerDay * KCAL_PER_KG;
  const expenditure = avgIntake - deltaEnergyPerDay;
  if (!Number.isFinite(expenditure) || expenditure < MIN_PLAUSIBLE || expenditure > MAX_PLAUSIBLE) {
    return null;
  }

  const confidence: ExpenditureConfidence =
    foodDays.length >= GOOD_FOOD_DAYS && pts.size >= GOOD_WEIGH_INS && weightSpanDays >= GOOD_SPAN_DAYS
      ? 'good'
      : 'ok';

  return {
    kcalPerDay: Math.round(expenditure / 10) * 10,
    avgIntakeKcal: Math.round(avgIntake),
    weightSlopeKgPerWeek: Math.round(slopePerDay * 7 * 20) / 20,
    daysCovered: foodDays.length,
    weightSpanDays,
    weighIns: pts.size,
    confidence,
  };
}

// ---- turning a measured TDEE into a BMR calibration factor -------------------
//
// The measured expenditure above is a TOTAL — it already contains the activity
// of those days. The daily budget, though, is «resting base (BMR×1.2, goal-
// adjusted) + today's earned steps/workouts». To fold the measurement into that
// model WITHOUT double-counting activity, we back out the resting piece:
//     resting maintenance = measured TDEE − average earned per day
//     implied BMR         = resting maintenance / 1.2 (the sedentary factor)
// and store it as a FACTOR over the formula BMR, not an absolute — a factor ages
// with weight (the formula BMR tracks the scale, the factor just tilts it), so a
// user who loses 10 kg doesn't keep an over-high stored number. Earned movement
// still adds per-day on top, exactly as before; the factor only re-anchors the
// resting base to what the body actually burned on an average day.

/// A day's earned (above-resting) energy inputs — steps and any structured
/// workout, mirroring what the budget already credits per day.
export interface EarnedDay {
  steps: number;
  workoutSteps: number;
  workoutKcal: number;
}

/// Average earned kcal/day over the given days — the same «шаги +N» + workout
/// eat-back the daily budget adds, so subtracting it from the measured TDEE
/// leaves a clean resting figure. Averaged over the days actually provided
/// (caller passes the window's recorded days), so partial step-logging doesn't
/// dilute it with phantom zero days. Returns 0 for an empty list (a user with no
/// movement data → the whole TDEE folds into the resting base, self-consistently).
export function averageEarnedKcal(days: EarnedDay[], weightKg: number): number {
  if (days.length === 0) return 0;
  const total = days.reduce(
    (s, d) =>
      s +
      stepsEarnedKcal(stepsOutsideWorkouts(d.steps, d.workoutSteps), weightKg) +
      Math.round(Math.max(0, d.workoutKcal) * EATBACK_FRACTION),
    0,
  );
  return total / days.length;
}

/// The one way this measurement lies: UNDER-LOGGED FOOD. The weight trend sees
/// everything you ate; the intake average only sees what you wrote down. Eat 2500
/// and log 2000 and the equation hands back an expenditure 500 too LOW — and the
/// error is invisible, because a consistently under-logged diary looks exactly
/// like a consistently small one. Missed WORKOUTS are harmless (the scale already
/// counted them), missed FOOD is not.
///
/// The one thing we can catch: a total daily expenditure below the resting BMR is
/// physiologically implausible for someone walking around — living costs more than
/// lying still. So when the measurement comes out under the formula's resting
/// figure, it's almost certainly a diary gap, not a slow metabolism. Callers warn
/// instead of offering to calibrate on it.
export function looksUnderLogged(measuredKcalPerDay: number, formulaBmr: number): boolean {
  if (!(formulaBmr > 0) || !Number.isFinite(measuredKcalPerDay)) return false;
  return measuredKcalPerDay < formulaBmr;
}

/// Clamp band for the stored factor — a real metabolism (plus the resting-base
/// absorption of un-logged activity) rarely sits outside ±35–50% of a
/// composition estimate; the band stops a data glitch from wrecking the budget.
export const BMR_FACTOR_MIN = 0.6;
export const BMR_FACTOR_MAX = 1.5;

/// The BMR factor that re-anchors the formula BMR to the measured energy balance,
/// or null when it can't be formed. `formulaBmr` is what the plan WOULD use
/// (Mifflin/Katch/RFM). Clamped to [BMR_FACTOR_MIN, BMR_FACTOR_MAX].
export function bmrFactorFromMeasured(
  measuredTdee: number,
  avgEarnedPerDay: number,
  formulaBmr: number,
): number | null {
  if (!(formulaBmr > 0) || !Number.isFinite(measuredTdee) || !Number.isFinite(avgEarnedPerDay)) {
    return null;
  }
  const resting = measuredTdee - Math.max(0, avgEarnedPerDay);
  const impliedBmr = resting / ACTIVITY_FACTORS.sedentary;
  const factor = impliedBmr / formulaBmr;
  if (!Number.isFinite(factor)) return null;
  return Math.min(BMR_FACTOR_MAX, Math.max(BMR_FACTOR_MIN, Math.round(factor * 1000) / 1000));
}
