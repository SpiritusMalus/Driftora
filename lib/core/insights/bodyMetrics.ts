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
/// Chosen deliberately: systematic reviews find Mifflin–St Jeor the most accurate
/// / least-biased predictive equation for both normal-weight AND obese adults
/// (Harris–Benedict overestimates). No predictive formula is exact at high BMI
/// (±10-20%) — only indirect calorimetry is — so the plan says «начните с этих
/// цифр и корректируйте по тренду».
export function mifflinBmr(sex: Sex, weightKg: number, heightCm: number, ageYears: number): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears + (sex === 'male' ? 5 : -161);
}

/// Which resting-energy formula the plan used — surfaced so the card can name it
/// honestly instead of presenting one number as ground truth.
export type BmrMethod = 'mifflin' | 'katch';

/// Katch–McArdle resting energy: 370 + 21.6 × lean body mass (kg). Uses body
/// COMPOSITION, not just total weight, so two people at the same kg but different
/// muscle read differently — the honest resolution of "120 kg качка ≠ 120 kg
/// толстого" (muscle burns at rest, fat barely does). This lives in BMR, NOT in
/// the per-workout burn: moving a given mass costs ~the same regardless of what
/// it's made of, so folding composition into MET would be false precision.
/// Only genuinely better than Mifflin when the body-fat % is MEASURED (smart
/// scale / calipers / DEXA); a guess doesn't add signal, so callers apply it
/// only for a plausible provided value (see [validBodyFatPct]).
export function katchMcArdleBmr(weightKg: number, bodyFatPct: number): number {
  const lbm = weightKg * (1 - bodyFatPct / 100);
  return 370 + 21.6 * lbm;
}

/// Plausible measured adult body-fat band. Outside it (incl. the 0 = "not set"
/// default) the value is treated as absent and the plan stays on Mifflin.
export function validBodyFatPct(pct: number | undefined): pct is number {
  return typeof pct === 'number' && Number.isFinite(pct) && pct >= 3 && pct <= 70;
}

// ---- workouts / active energy (MET-based, fully on-device — no external API) -

/// Structured-exercise types the user can log. Kept short (the common ones).
export type WorkoutType =
  | 'walk'
  | 'run'
  | 'cycle'
  | 'swim'
  | 'strength'
  | 'hiit'
  | 'elliptical'
  | 'row'
  | 'sport'
  | 'dance'
  | 'martial'
  | 'yoga';

export const WORKOUT_TYPES: readonly WorkoutType[] = [
  'walk',
  'run',
  'cycle',
  'swim',
  'strength',
  'hiit',
  'elliptical',
  'row',
  'sport',
  'dance',
  'martial',
  'yoga',
];

/// MET (metabolic equivalent) per type — moderate intensity, rounded from the
/// Compendium of Physical Activities. This is the FALLBACK used when the user
/// doesn't know / doesn't enter a pace. kcal = MET × weightKg × hours.
const WORKOUT_MET: Record<WorkoutType, number> = {
  walk: 4.3, // deliberate exercise walk, brisk (~5.6 km/h; Compendium 17190)
  run: 9.8, // ~9.7 km/h (Compendium 12050)
  cycle: 7.5, // ~19–22 km/h
  swim: 7.0,
  // Compendium 02050 «resistance training, multiple exercises, 8–15 reps» = 3.5
  // — the typical gym session INCLUDING inter-set rest, which our sets→minutes
  // path also models. The old 5.0 was the vigorous-bodybuilding entry stacked
  // on top of rest-inclusive minutes — it overshot trackers ~40% (device
  // feedback 2026-07-10: «подсчёт тренировок не очень точный»).
  strength: 3.5,
  hiit: 8.0, // circuit / HIIT
  elliptical: 5.0,
  row: 7.0,
  sport: 7.0, // football / basketball / etc.
  dance: 5.0,
  martial: 7.5,
  yoga: 2.8, // hatha / stretching
};

/// Types whose energy cost scales cleanly with speed — for these the UI offers an
/// optional km/h field, and [metForSpeed] refines the MET. The rest (strength,
/// yoga, sport…) have no meaningful single "speed", so they always use the fixed
/// moderate MET above.
export const SPEED_WORKOUT_TYPES: readonly WorkoutType[] = ['walk', 'run', 'cycle'];

export function supportsSpeed(type: WorkoutType): boolean {
  return SPEED_WORKOUT_TYPES.includes(type);
}

/// Sane km/h band per speed-capable type — used to clamp user input so a typo
/// (e.g. 200) can't blow up the estimate, and to hint the placeholder.
const SPEED_KMH_RANGE: Partial<Record<WorkoutType, { min: number; max: number }>> = {
  walk: { min: 2, max: 8 },
  run: { min: 5, max: 25 },
  cycle: { min: 8, max: 45 },
};

/// Compendium (2011) anchor points, km/h → MET, for pace-aware walking and
/// running. Interpolated linearly between anchors, flat outside them. Chosen
/// over the ACSM treadmill equations after a device-feedback accuracy audit
/// (2026-07-10): ACSM walking underestimated fast walking badly (4.8 vs the
/// Compendium's 8.3 at 8 km/h — the equation isn't valid past ~6.5 km/h), and
/// worse, an honestly-typed 5.5 km/h pace LOWERED the estimate below the fixed
/// brisk default (3.6 vs 4.3) — «уточнил → стало меньше». Anchors keep the
/// paced and default numbers on one scale (5.6 km/h ⇒ 4.3 ⇒ the walk default).
const WALK_MET_ANCHORS: readonly (readonly [number, number])[] = [
  [2.0, 2.0], // strolling
  [3.2, 2.8], // 2.0 mph
  [4.0, 3.0], // 2.5 mph
  [4.8, 3.5], // 3.0 mph
  [5.6, 4.3], // 3.5 mph, brisk
  [6.4, 5.0], // 4.0 mph, very brisk
  [7.2, 7.0], // 4.5 mph
  [8.0, 8.3], // 5.0 mph
];

/// Running anchors (Compendium 2011). The ACSM running equation tracked these
/// within ~5% mid-band but drifted +13% high by 13 km/h; the table is flatter
/// and matches the published per-speed entries exactly.
const RUN_MET_ANCHORS: readonly (readonly [number, number])[] = [
  [6.4, 6.0], // 4 mph
  [8.0, 8.3], // 5 mph
  [9.7, 9.8], // 6 mph
  [10.8, 10.5], // 6.7 mph
  [11.3, 11.0], // 7 mph
  [12.9, 11.8], // 8 mph
  [14.5, 12.8], // 9 mph
  [16.1, 14.5], // 10 mph
  [17.7, 16.0], // 11 mph
];

/// Piecewise-linear read of an anchor table; flat beyond the first/last anchor.
function interpolateMet(anchors: readonly (readonly [number, number])[], kmh: number): number {
  if (kmh <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x2, y2] = anchors[i];
    if (kmh <= x2) {
      const [x1, y1] = anchors[i - 1];
      return y1 + ((y2 - y1) * (kmh - x1)) / (x2 - x1);
    }
  }
  return anchors[anchors.length - 1][1];
}

/// MET from an actual pace, for the speed-capable types. Walking and running
/// interpolate the Compendium anchor tables above; cycling is a linear fit to
/// the Compendium speed buckets (air drag makes it steeper than walking).
/// Returns null for a type/speed we can't refine, so callers fall back to the
/// fixed [WORKOUT_MET].
export function metForSpeed(type: WorkoutType, speedKmh: number): number | null {
  const range = SPEED_KMH_RANGE[type];
  if (!range || !Number.isFinite(speedKmh) || speedKmh <= 0) return null;
  const kmh = Math.min(Math.max(range.min, speedKmh), range.max);
  switch (type) {
    case 'walk':
      return interpolateMet(WALK_MET_ANCHORS, kmh);
    case 'run':
      return interpolateMet(RUN_MET_ANCHORS, kmh);
    // Cycling — fit through the Compendium bucket midpoints (leisure ~15 km/h
    // ≈ 5.5, 16–19 ≈ 6.8, 19–22 ≈ 8.0, 22.5–25.6 ≈ 10, 26–31 ≈ 12); the old
    // −2.5 intercept sat ~0.5 MET low across the whole band. Floor 4.0 =
    // the Compendium's slowest leisure bucket.
    case 'cycle':
      return Math.max(4, 0.5 * kmh - 2);
    default:
      return null;
  }
}

/// Types logged in SETS, not minutes («делаю силовые — тебе не нужно знать
/// время»): the UI asks «сколько подходов» and estimates the duration at
/// [MIN_PER_SET] each. Kept to strength — cardio/HIIT are genuinely time-shaped.
export const SET_WORKOUT_TYPES: readonly WorkoutType[] = ['strength'];

export function supportsSets(type: WorkoutType): boolean {
  return SET_WORKOUT_TYPES.includes(type);
}

/// Average whole minutes ONE strength set occupies including the inter-set rest
/// (~30–60 s of work + ~2 min rest). The Compendium's weights MET already
/// averages work with rest, so sets × this feeds the same MET model honestly.
export const MIN_PER_SET = 3;

/// Sets → estimated minutes, clamped to a sane set count so a typo (300) can't
/// blow up the day's budget.
export function setsToMinutes(sets: number): number {
  if (!Number.isFinite(sets)) return 0;
  return Math.min(Math.max(0, Math.round(sets)), 60) * MIN_PER_SET;
}

/// «Дожиг» (EPOC): after resistance / interval work the body burns above rest
/// for 24–48 h — glycogen restock, fiber repair, protein synthesis. Studies put
/// it around 6–15% of the session's cost, so a conservative +10% is credited
/// for these types ONLY; steady cardio's afterburn is small enough that adding
/// it would be false precision.
export const EPOC_BONUS: Partial<Record<WorkoutType, number>> = {
  strength: 0.1,
  hiit: 0.1,
};

/// Whole-kcal from an explicit MET, minutes and weight — the shared core of the
/// MET model. Clamps garbage (minutes ≤ 10 h, weight to a sane band, MET must be
/// positive) so it never returns NaN. Used directly for a free-text "other"
/// activity whose MET the model supplied (no entry in [WORKOUT_MET]); note no
/// EPOC is added here — an unknown activity has no type to hang the bonus on.
export function kcalFromMet(met: number, minutes: number, weightKg: number): number {
  if (!Number.isFinite(met) || met <= 0) return 0;
  const min = Math.min(Math.max(0, minutes), 600);
  const kg = Math.min(Math.max(20, weightKg || 0), 400);
  return Math.round(met * kg * (min / 60));
}

/// Calories burned by one workout: MET × kg × hours plus the type's afterburn
/// ([EPOC_BONUS]), whole kcal. If a pace (km/h) is given for a speed-capable
/// type it refines the MET; otherwise the fixed moderate MET is used.
export function workoutKcal(
  type: WorkoutType,
  minutes: number,
  weightKg: number,
  speedKmh?: number | null,
): number {
  const fixed = WORKOUT_MET[type];
  if (fixed == null) return 0;
  const met = (speedKmh != null ? metForSpeed(type, speedKmh) : null) ?? fixed;
  const session = kcalFromMet(met, minutes, weightKg);
  return Math.round(session * (1 + (EPOC_BONUS[type] ?? 0)));
}

/// Share of burned exercise calories added back to the day's budget. Predictive
/// formulas overestimate expenditure ~20–30%, so only part is counted — this
/// guards against overeating on training days.
export const EATBACK_FRACTION = 0.75;

/// Layer a day's raw workout burn onto a base kcal figure (maintenance or a
/// target), counting EATBACK_FRACTION of it. Rounded to 10 kcal like the plan.
export function withWorkoutEnergy(
  baseKcal: number,
  workoutKcalRaw: number,
  fraction: number = EATBACK_FRACTION,
): number {
  return Math.round((baseKcal + Math.max(0, workoutKcalRaw) * fraction) / 10) * 10;
}

/// Suggest the lifestyle activity level from an average daily step count, so the
/// user picks the right multiplier instead of guessing. Steps stand in for NEAT
/// (everyday movement); structured workouts are logged separately ON TOP, so
/// this must never itself add exercise energy (that would double-count).
export function suggestActivityLevel(avgStepsPerDay: number): ActivityLevel {
  if (avgStepsPerDay >= 12000) return 'high';
  if (avgStepsPerDay >= 8000) return 'moderate';
  if (avgStepsPerDay >= 5000) return 'light';
  return 'sedentary';
}

/// Steps already covered by the RESTING base (BMR × sedentary factor): a
/// sedentary day still involves a few thousand incidental steps, so «earned»
/// walking energy is counted only ABOVE this — no double count with the base.
const STEP_REST_BASELINE = 3000;
/// Real walking energy per step per kg (~0.035 kcal/step at 70 kg) — the honest
/// cost of a step, kept transparent (shown as-is in the day's «шаги +N» line).
const KCAL_PER_STEP_PER_KG = 0.0005;

/// «Base + earned» model: kcal EARNED by today's steps above the resting baseline,
/// added to a resting-level budget. Always ≥ 0 — walking only ever adds to the
/// day, never subtracts (you did the movement, so you can eat it). This replaces
/// the activity multiplier as the budget's activity signal. Clamps input.
export function stepsEarnedKcal(steps: number, weightKg: number): number {
  const extra = Math.max(0, (Number.isFinite(steps) ? steps : 0) - STEP_REST_BASELINE);
  const kg = Math.min(Math.max(20, weightKg || 0), 400);
  return Math.round(extra * KCAL_PER_STEP_PER_KG * kg);
}

/// The day's assembled eating target under «база + заработал»: the tempo's
/// deficit base plus today's earned activity (steps above the baseline + the
/// workout eat-back), never below the healthy day-minimum. The minimum guards
/// the WHOLE day's intake, not the base alone: earned kcal fill the
/// base→minimum gap first, so the chosen deficit actually happens on days you
/// move (a per-base floor made «стандартный» и «быстрый» identical — the
/// deficit maths always lands below BMR at the sedentary factor), and only a
/// zero-movement day rests exactly at the minimum.
export function dayBudgetKcal(baseKcal: number, minDayKcal: number, earnedKcal: number): number {
  return Math.max(baseKcal + Math.max(0, earnedKcal), minDayKcal);
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
  /// Optional MEASURED body-fat %. Absent / 0 / out-of-band → plan uses Mifflin;
  /// a plausible value switches the BMR to composition-aware Katch–McArdle.
  bodyFatPct?: number;
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

/// How aggressive the pace is — the ONE lever the user chooses on top of the
/// mode (lose/maintain/gain picks the direction, this refines the "how fast").
/// Ignored for maintain (there is no pace to size). For lose:
///  - 'soft'     — a gentle −10%, for a small reserve / muscle-sparing;
///  - 'standard' — the default: the BMI-aware −15% (−20% at BMI ≥ 30), i.e. the
///                 exact pre-choice behaviour, so an untouched setting never
///                 changes anyone's plan;
///  - 'fast'     — an assertive −25%, for a large reserve. The BMR / clinical
///                 floor still caps it, so a small body just floors instead of
///                 crash-dieting.
/// For gain the same three levels size the SURPLUS: +5% / +10% / +15%.
export type DeficitTempo = 'soft' | 'standard' | 'fast';

/// Selection order for the tempo chip row (weight screen, lose & gain modes).
export const DEFICIT_TEMPOS: readonly DeficitTempo[] = ['soft', 'standard', 'fast'];

/// Explicit lose factors for the non-default tempos. 'standard' is intentionally
/// absent — it defers to the BMI-aware pair above so the default is unchanged.
const TEMPO_LOSE_FACTOR: Record<Exclude<DeficitTempo, 'standard'>, number> = {
  soft: 0.9, // −10%
  fast: 0.75, // −25%
};

/// Gain (surplus) factors for the non-default tempos; 'standard' again defers
/// to MODE_FACTOR.gain (+10%) so an untouched setting keeps the old plan.
/// Deliberately modest — muscle synthesis is slow and any surplus beyond it is
/// stored as fat, so even 'fast' is +15%, not a dirty bulk.
const TEMPO_GAIN_FACTOR: Record<Exclude<DeficitTempo, 'standard'>, number> = {
  soft: 1.05, // +5%
  fast: 1.15, // +15%
};

/// Neutral adult age used when the birth year isn't set yet, so the plan still
/// shows a usable estimate instead of vanishing (age shifts Mifflin BMR by only
/// ~5 kcal per year — small next to the total). The card flags this as a
/// «прикидка» and asks for the year to firm the number up.
const ASSUMED_ADULT_AGE = 35;

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
  /// True when the deficit base sits below the day-minimum: a zero-movement day
  /// rests at [minDayKcal]; movement re-opens the chosen deficit (see
  /// [dayBudgetKcal]).
  floored: boolean;
  /// The tempo's deficit base BEFORE the day-minimum — what the chosen pace
  /// actually asks for. May sit below [minDayKcal]; the day's target is
  /// assembled via [dayBudgetKcal], so earned activity fills that gap first.
  /// Equals [kcal] for maintain/gain and whenever the minimum doesn't bind.
  baseKcal: number;
  /// The day's healthy intake minimum — max(BMR, clinical minimum) for lose,
  /// 0 otherwise. The assembled day target never goes below it.
  minDayKcal: number;
  /// Resting metabolism (BMR) behind the plan, whole kcal — surfaced so the
  /// card can answer «какой у меня основной обмен?» with the same number a
  /// doctor / external calculator would give (the budget's «база» is NOT it).
  bmrKcal: number;
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
  /// True when the birth year wasn't set and a neutral adult age was assumed —
  /// the card shows the plan anyway but labels it a «прикидка» and asks for the
  /// year. False once a real birth year drives the estimate (or Katch–McArdle is
  /// used, where age doesn't enter the BMR at all).
  assumedAge: boolean;
  /// Which resting-energy formula produced `maintenanceKcal` — 'katch' when a
  /// measured body-fat % was available (composition-aware), else 'mifflin'.
  bmrMethod: BmrMethod;
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
  tempo: DeficitTempo = 'standard',
): MacroPlan | null {
  const sex = profile.sex === 'male' || profile.sex === 'female' ? (profile.sex as Sex) : null;
  const factor = (ACTIVITY_FACTORS as Record<string, number | undefined>)[profile.activityLevel];
  // Birth year is the ONE input we can safely default: age moves BMR by ~5 kcal
  // a year, so an unset year falls back to a neutral adult age (flagged) rather
  // than hiding the whole plan. Sex/activity/height/weight are NOT defaulted —
  // guessing those would fabricate the number, so they still gate the plan.
  const hasBirthYear = profile.birthYear > 0;
  const age = hasBirthYear ? now.getFullYear() - profile.birthYear : ASSUMED_ADULT_AGE;
  if (!sex || factor == null) return null;
  // A year that's SET but implausible (typo, future) is still rejected; only an
  // absent year gets the assumed-age fallback.
  if (hasBirthYear && !(age >= 14 && age <= 100)) return null;
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

  // Composition-aware BMR when a measured body-fat % is present (Katch–McArdle
  // uses lean mass, so muscle vs fat at the same weight finally diverges);
  // otherwise the population-average Mifflin. Age is unused under Katch.
  const useKatch = validBodyFatPct(profile.bodyFatPct);
  const bmr = useKatch
    ? katchMcArdleBmr(weightKg, profile.bodyFatPct as number)
    : mifflinBmr(sex, weightKg, profile.heightCm, age);
  const bmrMethod: BmrMethod = useKatch ? 'katch' : 'mifflin';
  const maintenance = bmr * factor;
  // The deficit's size: the user's tempo choice wins for lose (soft/fast), while
  // 'standard' keeps the BMI-aware default (−15%, −20% at BMI ≥ 30). The floor
  // below still caps whatever this produces, so 'fast' on a small body is safe.
  const loseFactor =
    tempo === 'standard'
      ? bmi >= OBESE_BMI
        ? LOSE_FACTOR_OBESE
        : MODE_FACTOR.lose
      : TEMPO_LOSE_FACTOR[tempo];
  // The same lever sizes the surplus for gain (+5/+10/+15%); maintain has no
  // pace, so the tempo is simply ignored there.
  const gainFactor = tempo === 'standard' ? MODE_FACTOR.gain : TEMPO_GAIN_FACTOR[tempo];
  const raw = maintenance * (mode === 'lose' ? loseFactor : mode === 'gain' ? gainFactor : 1);
  // Never prescribe eating below resting needs or the clinical minimum. The
  // floor guards the DAY's intake ([dayBudgetKcal]), so `kcal` here is the
  // zero-movement day: the deficit base lifted to the minimum. The unlifted
  // base is returned alongside — earned activity re-opens the chosen deficit.
  const floor = mode === 'lose' ? Math.max(bmr, MIN_KCAL[sex]) : 0;
  const floored = mode === 'lose' && raw < floor;
  const kcal = Math.round(Math.max(raw, floor) / 10) * 10;
  const baseKcal = Math.round(raw / 10) * 10;
  const minDayKcal = mode === 'lose' ? Math.round(floor / 10) * 10 : 0;
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
    baseKcal,
    minDayKcal,
    bmrKcal: Math.round(bmr),
    fiber,
    proteinBasis,
    proteinBasisKg: Math.round(basisKg),
    etaWeeks,
    // Under Katch–McArdle age never enters the BMR, so an unset year isn't an
    // assumption the number rests on — don't nag for it in that case.
    assumedAge: !hasBirthYear && !useKatch,
    bmrMethod,
  };
}

/// Maintenance КБЖУ (the pre-goal-modes API; kept for existing callers/tests).
export function suggestTargets(profile: BodyProfile, weightKg: number, now: Date = new Date()): MacroTargets | null {
  const plan = suggestPlan(profile, weightKg, 'maintain', now);
  return plan ? { kcal: plan.kcal, prot: plan.prot, fat: plan.fat, carb: plan.carb } : null;
}

/// The RESTING-level plan — the «база» of the base+earned budget: goal-adjusted
/// maintenance at the SEDENTARY factor (what you can eat if you barely moved).
/// Steps ([stepsEarnedKcal]) and workouts are added on top, so daily activity
/// always adds and is never double-counted. Forces the sedentary factor
/// regardless of the stored activity level (which no longer drives the budget —
/// today's steps are the activity signal). Null until the profile is complete.
export function restingPlan(
  profile: BodyProfile,
  weightKg: number,
  mode: GoalMode,
  now: Date = new Date(),
  goalWeightKg = 0,
  tempo: DeficitTempo = 'standard',
): MacroPlan | null {
  return suggestPlan({ ...profile, activityLevel: 'sedentary' }, weightKg, mode, now, goalWeightKg, tempo);
}
