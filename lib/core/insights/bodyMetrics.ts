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

/// Maintenance КБЖУ from the profile + current weight, or null until the
/// profile is complete/plausible. Split: protein 1.6 g/kg (general sports-
/// nutrition consensus), fat 30% of kcal, carbs the remainder — coarse,
/// defensible defaults, not a prescription.
export function suggestTargets(profile: BodyProfile, weightKg: number, now: Date = new Date()): MacroTargets | null {
  const sex = profile.sex === 'male' || profile.sex === 'female' ? (profile.sex as Sex) : null;
  const factor = (ACTIVITY_FACTORS as Record<string, number | undefined>)[profile.activityLevel];
  const age = now.getFullYear() - profile.birthYear;
  if (!sex || factor == null) return null;
  if (!(age >= 14 && age <= 100)) return null;
  if (!(profile.heightCm >= 100 && profile.heightCm <= 250)) return null;
  if (!(weightKg >= 20 && weightKg <= 400)) return null;

  const kcal = Math.round((mifflinBmr(sex, weightKg, profile.heightCm, age) * factor) / 10) * 10;
  const prot = Math.round(1.6 * weightKg);
  const fat = Math.round((kcal * 0.3) / 9);
  const carb = Math.max(0, Math.round((kcal - prot * 4 - fat * 9) / 4));
  return { kcal, prot, fat, carb };
}
