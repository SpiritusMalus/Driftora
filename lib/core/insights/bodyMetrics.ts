/// Body metrics math: BMI (WHO bands) and maintenance-energy estimation
/// (Mifflin–St Jeor). Pure and offline, like every insights module.
///
/// HONESTY NOTE (surfaces in the UI copy): BMI was invented by Adolphe Quetelet
/// in the 1830s as a POPULATION statistic — it was never designed to assess an
/// individual and cannot tell muscle from fat, so muscular people read as
/// "overweight". We show it as a reference point, never a verdict. Likewise the
/// Mifflin–St Jeor result is a population-average estimate, presented as a
/// starting point to adjust by the real weight trend, not as a prescription.

/// BMI = kg / m². Returns one-decimal value, or null when inputs are not
/// plausible adult measurements (guards against '17' typed mid-way for 170).
export function bmiValue(weightKg: number, heightCm: number): number | null {
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm)) return null;
  if (weightKg < 20 || weightKg > 400) return null;
  if (heightCm < 100 || heightCm > 250) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

/// WHO classification bands (the "global BMI system").
export type BmiCategory = 'underweight' | 'normal' | 'overweight' | 'obese1' | 'obese2' | 'obese3';

export function bmiCategory(bmi: number): BmiCategory {
  if (bmi < 18.5) return 'underweight';
  if (bmi < 25) return 'normal';
  if (bmi < 30) return 'overweight';
  if (bmi < 35) return 'obese1';
  if (bmi < 40) return 'obese2';
  return 'obese3';
}

// ---- maintenance КБЖУ (Mifflin–St Jeor × activity) --------------------------

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'high';

/// Standard TDEE multipliers over BMR (sedentary desk life → daily training).
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
};

/// Selection order for the activity chip row.
export const ACTIVITY_LEVELS: readonly ActivityLevel[] = ['sedentary', 'light', 'moderate', 'high'];

/// Mifflin–St Jeor resting energy: 10·kg + 6.25·cm − 5·age, +5 male / −161 female.
export function mifflinBmr(sex: Sex, weightKg: number, heightCm: number, ageYears: number): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears + (sex === 'male' ? 5 : -161);
}

export interface MacroTargets {
  kcal: number;
  prot: number;
  fat: number;
  carb: number;
}

/// Profile as stored in app_settings — empty string / 0 mean "not set yet".
export interface BodyProfile {
  sex: string;
  birthYear: number;
  heightCm: number;
  activityLevel: string;
}

// ---- goal-aware plan (похудение / поддержание / набор) ----------------------

/// The user's current goal for the nutrition plan card.
export type GoalMode = 'lose' | 'maintain' | 'gain';

/// Selection order for the mode chip row.
export const GOAL_MODES: readonly GoalMode[] = ['lose', 'maintain', 'gain'];

/// Gentle, sustainable adjustments over maintenance — deliberately NOT crash
/// numbers: lose = −15% (−20% at BMI ≥ 30: the larger reserve makes a slightly
/// faster pace safe, and protein below protects muscle), gain = +10%.
const MODE_FACTOR: Record<GoalMode, number> = { lose: 0.85, maintain: 1, gain: 1.1 };
const LOSE_FACTOR_OBESE = 0.8;
const OBESE_BMI = 30;

/// Protein: 1.8 g/kg in a deficit (muscle preservation), 1.6 g/kg otherwise.
/// In a deficit the KILOGRAMS are the basis picked by [proteinBasis] below —
/// never blindly the total weight at high BMI.
const PROTEIN_PER_KG: Record<GoalMode, number> = { lose: 1.8, maintain: 1.6, gain: 1.6 };

/// Unsupervised-dieting floors (common clinical guidance). Combined with the
/// BMR floor these keep the "lose" plan honest for small/light bodies.
const MIN_KCAL: Record<Sex, number> = { male: 1500, female: 1200 };

/// ≈7,700 kcal per kg of body fat — powers the honest pace estimate.
const KCAL_PER_KG_FAT = 7700;

/// IOM adequate-intake rule of thumb: 14 g of fiber per 1000 kcal. Satiety is
/// the main lever against deficit hunger, so the plan states it explicitly.
const FIBER_PER_1000_KCAL = 14;

/// What the protein grams were computed from. Adipose tissue needs almost no
/// protein, so "g/kg of TOTAL weight" over-prescribes at high body fat
/// (1.8 × 130 kg = 234 g — неподъёмно и не нужно). Precision ladder, best
/// available first:
///  - 'goal'     — the user's explicit goal weight (clamped to the BMI-18.5
///                 floor so an absurd goal never drives the plan);
///  - 'adjusted' — clinical adjusted body weight (IBW@BMI25 + 0.4 × excess)
///                 when BMI ≥ 30 and no goal is set;
///  - 'current'  — the logged weight (fine below BMI 30).
export type ProteinBasis = 'goal' | 'adjusted' | 'current';

export interface MacroPlan extends MacroTargets {
  mode: GoalMode;
  /// Maintenance (TDEE) the plan was derived from, rounded to 10 kcal.
  maintenanceKcal: number;
  /// Expected pace at this deficit/surplus, kg per week (magnitude; 0 for maintain).
  paceKgPerWeek: number;
  /// True when the safety floors (BMR / clinical minimum) capped the deficit.
  floored: boolean;
  /// Daily fiber guideline for this kcal level (14 g / 1000 kcal) — guidance
  /// for hunger control, not a tracked diary target (meals don't persist fiber).
  fiber: number;
  /// TRANSPARENCY: which kilograms the protein was computed from — the card
  /// says so instead of leaving a smaller-than-expected number unexplained.
  proteinBasis: ProteinBasis;
  proteinBasisKg: number;
  /// Honest ETA to the goal weight at this pace, in whole weeks. Null when no
  /// applicable goal is set or the pace is zero (floored deficit).
  etaWeeks: number | null;
}

/// Goal-aware КБЖУ plan from the profile + the LATEST logged weight — the card
/// recomputes from every new weigh-in, so the plan follows the body, not a
/// stale number. Null until the profile is complete/plausible. Fat is 30% of
/// kcal, carbs the remainder — coarse, defensible defaults, not a prescription.
/// `goalWeightKg` (0 = not set) participates only when it points in the mode's
/// direction: lose wants it below the current weight, gain above.
export function suggestPlan(
  profile: BodyProfile,
  weightKg: number,
  mode: GoalMode,
  now: Date = new Date(),
  goalWeightKg = 0,
): MacroPlan | null {
  const sex = profile.sex === 'male' || profile.sex === 'female' ? (profile.sex as Sex) : null;
  const factor = (ACTIVITY_FACTORS as Record<string, number | undefined>)[profile.activityLevel];
  const age = now.getFullYear() - profile.birthYear;
  if (!sex || factor == null) return null;
  if (!(age >= 14 && age <= 100)) return null;
  if (!(profile.heightCm >= 100 && profile.heightCm <= 250)) return null;
  if (!(weightKg >= 20 && weightKg <= 400)) return null;

  const heightM = profile.heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  // A goal only counts when plausible and pointing where the mode goes; an
  // absurdly low goal is clamped to the BMI-18.5 floor — we never plan a body
  // below the healthy band.
  const minHealthyKg = 18.5 * heightM * heightM;
  const goalPlausible = Number.isFinite(goalWeightKg) && goalWeightKg >= 20 && goalWeightKg <= 400;
  const goalKg =
    goalPlausible && ((mode === 'lose' && goalWeightKg < weightKg) || (mode === 'gain' && goalWeightKg > weightKg))
      ? Math.max(goalWeightKg, minHealthyKg)
      : null;

  const bmr = mifflinBmr(sex, weightKg, profile.heightCm, age);
  const maintenance = bmr * factor;
  const loseFactor = bmi >= OBESE_BMI ? LOSE_FACTOR_OBESE : MODE_FACTOR.lose;
  const raw = maintenance * (mode === 'lose' ? loseFactor : MODE_FACTOR[mode]);
  // Never prescribe eating below resting needs or the clinical minimum: a
  // smaller deficit is slower but stays out of crash-diet territory.
  const floor = mode === 'lose' ? Math.max(bmr, MIN_KCAL[sex]) : 0;
  const floored = mode === 'lose' && raw < floor;
  const kcal = Math.round(Math.max(raw, floor) / 10) * 10;
  const maintenanceKcal = Math.round(maintenance / 10) * 10;
  // Directional, clamped at 0: a fully-floored "lose" plan can sit AT (or, for
  // very small bodies, above) maintenance — that is a zero pace, not a gain.
  const dailyGap =
    mode === 'lose' ? Math.max(0, maintenanceKcal - kcal) : mode === 'gain' ? Math.max(0, kcal - maintenanceKcal) : 0;
  const paceKgPerWeek = Math.round((dailyGap * 7 * 10) / KCAL_PER_KG_FAT) / 10;

  // Protein basis: enough to keep muscle, without prescribing plates nobody
  // can (or should) eat — see [ProteinBasis].
  let basisKg = weightKg;
  let proteinBasis: ProteinBasis = 'current';
  if (mode === 'lose' && goalKg != null) {
    basisKg = goalKg;
    proteinBasis = 'goal';
  } else if (mode === 'lose' && bmi >= OBESE_BMI) {
    const ibwKg = 25 * heightM * heightM;
    basisKg = ibwKg + 0.4 * (weightKg - ibwKg);
    proteinBasis = 'adjusted';
  }
  const prot = Math.round(PROTEIN_PER_KG[mode] * basisKg);
  const fat = Math.round((kcal * 0.3) / 9);
  const carb = Math.max(0, Math.round((kcal - prot * 4 - fat * 9) / 4));
  const fiber = Math.round((kcal * FIBER_PER_1000_KCAL) / 1000);
  const etaWeeks = goalKg != null && paceKgPerWeek > 0 ? Math.round(Math.abs(weightKg - goalKg) / paceKgPerWeek) : null;
  return {
    mode,
    kcal,
    prot,
    fat,
    carb,
    maintenanceKcal,
    paceKgPerWeek,
    floored,
    fiber,
    proteinBasis,
    proteinBasisKg: Math.round(basisKg),
    etaWeeks,
  };
}

/// Maintenance КБЖУ (the pre-goal-modes API; kept for existing callers/tests).
export function suggestTargets(profile: BodyProfile, weightKg: number, now: Date = new Date()): MacroTargets | null {
  const plan = suggestPlan(profile, weightKg, 'maintain', now);
  return plan ? { kcal: plan.kcal, prot: plan.prot, fat: plan.fat, carb: plan.carb } : null;
}
