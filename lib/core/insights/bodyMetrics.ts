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
///  - 'mifflin'   — population-average, from weight/height/age (no composition);
///  - 'katch'     — composition-aware, from a MEASURED body-fat %;
///  - 'katch-rfm' — composition-aware, but the body-fat % was ESTIMATED from a
///                  waist tape (RFM), not measured — weaker signal, named apart
///                  so the card never dresses a tape estimate up as a scan.
///  - 'measured'  — calibrated to the user's OWN energy balance (weight trend +
///                  food log): the formula BMR tilted by a stored factor. The
///                  most accurate once enough data exists; overrides the rest.
export type BmrMethod = 'mifflin' | 'katch' | 'katch-rfm' | 'measured';

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

/// Plausible adult waist circumference (cm). Outside it (incl. the 0 = "not set"
/// default) the tape estimate is treated as absent.
export function validWaistCm(cm: number | undefined): cm is number {
  return typeof cm === 'number' && Number.isFinite(cm) && cm >= 40 && cm <= 200;
}

/// A stored BMR calibration factor (adaptive «Использовать мой обмен»). 0 = not
/// set. A plausible value re-anchors the formula BMR to the user's measured
/// energy balance; the band mirrors the clamp the factor was stored with, with a
/// hair of tolerance. See adaptiveExpenditure.bmrFactorFromMeasured.
export function validBmrFactor(f: number | undefined): f is number {
  return typeof f === 'number' && Number.isFinite(f) && f >= 0.5 && f <= 1.6;
}

/// Relative Fat Mass (Woolcott & Bergman, 2018): a DEVICE-FREE body-fat estimate
/// from height + waist + sex alone — just a cloth tape, no impedance scale. It
/// was validated against DEXA on >12,000 adults and beats BMI, partly because it
/// correlates only weakly with muscle mass, so a muscular person isn't mislabeled
/// the way BMI mislabels them. The point of it here: it captures the composition
/// Mifflin ignores, which is exactly where a formula-only estimate drifts from a
/// body scan.
///   men:   64 − 20 × (height / waist)
///   women: 76 − 20 × (height / waist)   (height & waist in the same unit)
/// Returns the % clamped into the plausible band, or null when the waist/height
/// aren't usable adult measurements. It is an ESTIMATE — weaker than a caliper /
/// DEXA / scale read — so callers tag the BMR method 'katch-rfm', not 'katch'.
/// Validated for ages ~20–79; outside that it's rougher (still better than BMI).
export function rfmBodyFatPct(sex: Sex, heightCm: number, waistCm: number): number | null {
  if (!validWaistCm(waistCm)) return null;
  if (!(Number.isFinite(heightCm) && heightCm >= 100 && heightCm <= 250)) return null;
  const intercept = sex === 'female' ? 76 : 64;
  const pct = intercept - 20 * (heightCm / waistCm);
  if (!Number.isFinite(pct)) return null;
  // Clamp into the plausible band rather than discard a slightly-out value.
  return Math.min(70, Math.max(3, Math.round(pct * 10) / 10));
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
/// doesn't know / doesn't enter a pace. These are the Compendium's own
/// resting-inclusive values; [kcalFromMet] nets the resting hour back out.
const WORKOUT_MET: Record<WorkoutType, number> = {
  // 2024 Adult Compendium 17200, «3.5–3.9 mph, level, brisk, firm surface,
  // walking for exercise». Was 4.3 (a 2011-edition value, cited against a code
  // that in 2024 means the slower 2.8–3.4 mph bracket) — 10% low.
  walk: 4.8,
  run: 9.3, // 12050, «6–6.3 mph (10 min/mile)» — was 9.8, 5% high
  cycle: 8.0, // 01030, «12–13.9 mph, leisure, moderate effort» — was 7.5, 6% low
  swim: 7.0,
  // Compendium 02050 «resistance training, multiple exercises, 8–15 reps» = 3.5
  // — the typical gym session INCLUDING inter-set rest, which our sets→minutes
  // path also models. The old 5.0 was the vigorous-bodybuilding entry stacked
  // on top of rest-inclusive minutes — it overshot trackers ~40% (device
  // feedback 2026-07-10: «подсчёт тренировок не очень точный»).
  strength: 3.5,
  // 02040, «circuit training, including kettlebells, some aerobic movement with
  // minimal rest» — the most demanding circuit entry there is. Was 8.0, which no
  // circuit entry in the 2024 edition reaches; the only ≥8 interval code (8.8)
  // is cycling-specific, and true burpee-style intervals are 11.0 (02214).
  hiit: 7.5,
  elliptical: 5.0, // 02048, moderate effort — matches exactly
  row: 7.0,
  sport: 7.0, // football / basketball / etc.
  dance: 5.0,
  martial: 7.5,
  yoga: 2.3, // 02150 «Yoga, Hatha» (and 02175 «Yoga, General») — was 2.8, 22% high
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
  [4.8, 3.8], // 2.8–3.4 mph bracket (17190) — was 3.5
  [5.6, 4.8], // 3.5–3.9 mph, brisk, walking for exercise (17200) — was 4.3
  [6.4, 5.5], // 4.0–4.4 mph, very brisk (17220) — was 5.0
  [7.2, 7.0], // 4.5 mph
  [8.0, 8.3], // 5.0 mph
];

/// Running anchors (Compendium 2011). The ACSM running equation tracked these
/// within ~5% mid-band but drifted +13% high by 13 km/h; the table is flatter
/// and matches the published per-speed entries exactly.
const RUN_MET_ANCHORS: readonly (readonly [number, number])[] = [
  [6.4, 6.0], // 4 mph
  [8.0, 8.5], // 5 mph (12030) — was 8.3
  [9.7, 9.3], // 6–6.3 mph, 10 min/mile (12050) — was 9.8
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

/// Effort level for strength — the one lever that actually moves resistance-work
/// energy (a heavy squat set and a light isolation set are NOT the same 3.5 MET;
/// device feedback 2026-07-13: «силовые занижены»). Only strength offers it; the
/// UI shows a chip. Absent → the fixed moderate [WORKOUT_MET].strength (3.5).
export type StrengthIntensity = 'light' | 'moderate' | 'heavy';
export const STRENGTH_INTENSITIES: readonly StrengthIntensity[] = ['light', 'moderate', 'heavy'];

/// MET per strength effort, Compendium 2011 resistance-training entries:
/// light/general 3.5 (02054, 8–15 reps varied) · moderate 5.0 (between) · heavy
/// 6.0 (02050, squats/deadlift high intensity). All already average work + rest,
/// so they compose with the sets→minutes estimate the same way 3.5 did.
const STRENGTH_MET: Record<StrengthIntensity, number> = {
  light: 3.5,
  moderate: 5.0,
  heavy: 6.0,
};

/// Whether [type] supports an effort chip (strength only, for now).
export function supportsIntensity(type: WorkoutType): boolean {
  return type === 'strength';
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

/// NO EPOC («дожиг») TERM — deliberately, after checking the literature the old
/// +10% for strength/HIIT was resting on. What the evidence actually says:
///  - the 6–15%-of-session figure (Børsheim & Bahr, Sports Med 2003) is an UPPER
///    bound for demanding protocols — submaximal ≥50 min at ≥70% VO₂max, or
///    supramaximal ≥6 min at ≥105% VO₂max. The reviewers note untrained people
///    are unlikely to tolerate those, so a typical user never reaches them;
///  - for RESISTANCE training the intensity/duration relationships are
///    explicitly UNESTABLISHED — «no data», not «confirmed»;
///  - the systematic review that does exist (Farinatti 2013, 16 studies, 155
///    mostly-trained young adults) found EPOC spanning 4.1–114 kcal, a 28-fold
///    spread with most protocols at 10–60 min. No single constant lives there;
///  - the widely-quoted «~10%» refers to metabolic rate sitting 10% above
///    baseline for 2 h — roughly 12–15 kcal — NOT 10% of the session's cost.
///    Different denominator, off by about an order of magnitude;
///  - a controlled crossover (Paoli 2012, n=8, indirect calorimetry) found NO
///    significant RMR elevation at 12/24/36/48 h after resistance work up to
///    20,000 kg of load-volume;
///  - measured duration for ordinary sessions is ~28 min, and statistically
///    identical after HIIT and steady running — the «24–48 hours» story the old
///    comment told does not survive direct measurement;
///  - EPOC after steady cardio is NOT zero either (Panissa 2021: ~24–38 kcal vs
///    ~32–69 for intervals), so the old strength-and-HIIT-only split was the
///    wrong shape as well as the wrong size;
///  - worst of all, a flat percentage on top of a MET estimate DOUBLE-COUNTS for
///    short-rest circuit work: shorter rests raise EPOC precisely by lowering
///    in-session expenditure, while the MET table assumes continuous work.
/// The honest magnitude left over is tens of kcal — smaller than this model's
/// own error bars and far smaller than [EATBACK_FRACTION]'s correction. Adding a
/// number that the evidence cannot size is theatre, so it is gone.

/// The body's resting cost in the units the MET model works in (kcal per kg per
/// hour). The Compendium's convention is 1 MET = 3.5 ml O₂·kg⁻¹·min⁻¹ ≈ 1
/// kcal·kg⁻¹·h⁻¹, and that convention is measurably too high:
///  - Byrne 2005, 769 weight-stable adults aged 18–74, 35–186 kg: measured
///    0.84 ± 0.16 kcal·kg⁻¹·h⁻¹, i.e. the 1.0 convention overstates rest by
///    ~19%. Body composition explained 62% of the variance, age only 14%;
///  - a 2021 systematic review (23 studies, 1091 adults aged 60+) put the
///    measured value at 2.7 ± 0.6 ml O₂·kg⁻¹·min⁻¹ against the standard 3.5;
///  - in 1331 adults averaging BMI 42.5 the figure falls monotonically as BMI
///    rises (p<0.001, both sexes), so the error is worst exactly for the users
///    the RFM and adaptive-BMR work was built for;
///  - the Compendium's own authors call 3.5 «a proxy value» with known potential
///    to overestimate RMR.
/// 0.84 is therefore the population fallback, not 1.0. Byrne's own stated
/// recommendation is to use each person's measured or predicted RMR as the
/// correction factor — see [restingRateFor], which does exactly that whenever
/// the caller knows the user's BMR.
///
/// WHY PERSONAL AND NOT A BETTER CONSTANT — the mechanism, from indirect
/// calorimetry in 205 adults across BMI 17.5–43.2. Two things move in opposite
/// directions as adiposity rises: the GROSS cost of walking per kg falls (4.37 →
/// 4.12 W/kg from normal weight to obese, p = 0.02) while the resting rate falls
/// too (standing 4.1 → 3.2 ml·kg⁻¹·min⁻¹). Net cost comes out invariant across
/// body types ONLY because those two cancel — and they cancel only when the
/// resting term is that person's own. Subtracting a fixed population figure
/// breaks the cancellation and re-introduces the body-composition bias that a
/// correct net calculation exists to remove. A separate trial (n=103, BMI 31.0 ±
/// 4.5) measured the damage: at light walking the GROSS estimate was already
/// almost exact (offset 99.0% ± 3.8%), while the fixed-1-MET NET estimate
/// overshot by 18.5% — the whole error being the gap between the assumed 3.5 and
/// the measured 2.54. So the personal rate is not a refinement here; it is the
/// thing that makes the subtraction legitimate at all.
///
/// Honest counterweight: the Compendium's own obesity citation (Browning et al.,
/// women with obesity at BMI 33.9) found energy expenditure 8–15% HIGHER than in
/// women without. The direction of error at BMI ≥ 30 is therefore not a settled
/// one-way overestimate, which is another reason this subtracts a measured-ish
/// personal quantity rather than applying a blanket high-BMI coefficient.
export const POPULATION_RESTING_KCAL_PER_KG_H = 0.84;

/// Plausible band for a personal resting rate, kcal·kg⁻¹·h⁻¹. The measured range
/// runs from ~0.71 (severely obese adults, n=1331 at mean BMI 42.5) up past 1.0
/// for lean young adults, so the band is that with headroom on both sides.
const RESTING_RATE_MIN = 0.5;
const RESTING_RATE_MAX = 1.2;

/// This user's own resting cost per kg per hour, from the BMR the plan already
/// computes (Mifflin, Katch–McArdle, RFM or the adaptive `bmr_factor`).
///
/// An out-of-band result is CLAMPED, never swapped for the population value.
/// That distinction matters and it was wrong here first: a 130 kg user whose
/// adaptive factor put their BMR at 1539 came out at 0.49, just under the floor,
/// and the old code answered 0.84 — handing the person with the LOWEST measured
/// metabolism the LARGEST resting subtraction, with a discontinuous jump from
/// 0.56 to 0.84 as the factor crossed 0.7. Clamping keeps the function monotone
/// in BMR, which is the property that actually protects heavy users.
///
/// The population value stands in only when there is no personal number at all —
/// an incomplete profile — so a walk logged before body setup still gets a
/// defensible estimate, just not a personal one.
export function restingRateFor(bmrKcalPerDay?: number | null, weightKg?: number | null): number {
  if (!Number.isFinite(bmrKcalPerDay ?? NaN) || !Number.isFinite(weightKg ?? NaN)) {
    return POPULATION_RESTING_KCAL_PER_KG_H;
  }
  const kg = weightKg as number;
  const bmr = bmrKcalPerDay as number;
  if (kg < 20 || kg > 400 || bmr <= 0) return POPULATION_RESTING_KCAL_PER_KG_H;
  const rate = bmr / (kg * 24);
  return Math.min(RESTING_RATE_MAX, Math.max(RESTING_RATE_MIN, rate));
}

/// Whole-kcal from an explicit MET, minutes and weight — the shared core of the
/// MET model. Returns the ACTIVE (above-resting) cost: an hour of any activity
/// contains an hour of merely existing, and the budget's resting base already
/// paid for it. `restingRate` is the user's own cost of existing when known (see
/// [restingRateFor]); the population value stands in otherwise.
///
/// Clamps garbage (minutes ≤ 10 h, weight to a sane band, MET must be positive)
/// so it never returns NaN, and a sub-resting MET floors at 0 rather than going
/// negative. Used directly for a free-text "other" activity whose MET the model
/// supplied (no entry in [WORKOUT_MET]).
export function kcalFromMet(
  met: number,
  minutes: number,
  weightKg: number,
  restingRate: number = POPULATION_RESTING_KCAL_PER_KG_H,
): number {
  if (!Number.isFinite(met) || met <= 0) return 0;
  const min = Math.min(Math.max(0, minutes), 600);
  const kg = Math.min(Math.max(20, weightKg || 0), 400);
  const rest = Number.isFinite(restingRate) ? restingRate : POPULATION_RESTING_KCAL_PER_KG_H;
  return Math.round(Math.max(0, met - rest) * kg * (min / 60));
}

/// Calories burned by one workout — the ACTIVE cost, whole kcal. If a pace (km/h)
/// is given for a speed-capable type it refines the MET; for strength an effort
/// level ([intensity]) picks the MET; otherwise the fixed moderate MET is used.
/// `restingRate` personalises the resting subtraction — see [restingRateFor].
/// No afterburn is added; the reasoning is above [POPULATION_RESTING_KCAL_PER_KG_H].
export function workoutKcal(
  type: WorkoutType,
  minutes: number,
  weightKg: number,
  speedKmh?: number | null,
  intensity?: StrengthIntensity | null,
  restingRate: number = POPULATION_RESTING_KCAL_PER_KG_H,
): number {
  const fixed = WORKOUT_MET[type];
  if (fixed == null) return 0;
  const paced = speedKmh != null ? metForSpeed(type, speedKmh) : null;
  const byEffort = type === 'strength' && intensity != null ? STRENGTH_MET[intensity] : null;
  const met = paced ?? byEffort ?? fixed;
  return kcalFromMet(met, minutes, weightKg, restingRate);
}

/// Share of a workout's burn added back to the day's eating budget.
///
/// 0.72 is not a safety margin picked for feel — it is the measured ADDITIVITY
/// of activity energy. In the largest paired doubly-labelled-water dataset
/// (Careau 2021, n = 1754 adults, 692 men / 1062 women, 18–96 y, BMI 12.5–61.7)
/// only ~72% of the energy burned in extra activity shows up as extra total
/// daily expenditure; the rest is offset by a fall in basal expenditure. The
/// regression of total on basal expenditure, adjusted for age, sex, fat-free and
/// fat mass, gives a slope of 0.723 ± 0.049, 95% CI [0.626, 0.820] — an interval
/// that excludes 1, and whose upper bound sits below the 0.9 this used to be.
/// The same compensation shows up WITHIN people: in 68 adults measured twice
/// about seven years apart, activity and basal expenditure correlated r = −0.58.
///
/// Three honesty notes, because this number is less settled than it looks:
///  - the literature disagrees. A 2025 DLW study spanning sedentary adults to
///    ultraendurance runners (n = 75) found activity related to total expenditure
///    LINEARLY with no plateau and explicitly rejected the compensated model;
///  - a 24-week RCT (n = 29, BMI 34, DLW) found compensation is BIMODAL, not a
///    uniform discount: 48% of participants came in 308 ± 158 kcal/day below the
///    additive prediction while the rest came in 94 ± 124 above, with no way to
///    tell in advance who is which. A single coefficient is wrong for everyone
///    individually and right only on average;
///  - compensation scales with adiposity (29.7% at the 10th BMI percentile,
///    45.7% at the 90th), which is a real gradient — a user at the top of it
///    nets only ~54%, not 72%. It is deliberately NOT indexed here anyway: the
///    same dataset leaves the direction of causality unresolved (does fat drive
///    compensation, or compensation drive fat?), and the RCT above found no
///    difference in BMI between compensators and non-compensators at all. A
///    gradient you cannot attribute is not a coefficient you can key on.
///
/// What it is NOT: a claim that MET tables overstate expenditure. That was the
/// old justification here and no source supports it — the measured bias of the
/// MET approach is about 209 kcal per WEEK (~30/day) in the worst subgroup. The
/// correction belongs to additivity, which acts on the DAY, not on the session.
export const EATBACK_FRACTION = 0.72;

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
/// KNOWN-WEAK, and no better constant exists — the MODEL SHAPE is what's wrong.
/// A controlled validation (n=100, treadmill, five fixed cadences, metabolic-cart
/// reference) found a pedometer's step→kcal conversion missed at EVERY cadence
/// and, worse, flipped sign: it underestimated at 80 steps/min and overestimated
/// at 90, 100, 110 and 120. The authors traced the error to the conversion model
/// itself, not to step detection or stride length — so a per-step constant is
/// falsified as a cadence-invariant model, and tuning this number cannot fix it.
/// Two further cracks: step COUNTING itself was unreliable below 100 steps/min
/// (slow walkers — older and heavier users — feed a biased count in), and the
/// energy cost of walking is U-shaped in speed with a minimum near 4 km/h, which
/// a per-step figure ignores entirely. Cadence also maps to intensity differently
/// by sex, so «per step, scaled only by mass» cannot be universal.
///
/// The one part that IS validated is scaling by body mass. Measured by indirect
/// calorimetry in 205 adults spanning BMI 17.5–43.2 and 3.0–52.8% body fat, the
/// NET cost of walking per kg per metre is statistically independent of fatness,
/// BMI and sex: 2.23 / 2.18 / 2.26 J·kg⁻¹·m⁻¹ for normal weight / overweight /
/// obese (p = 0.54). A 120 kg person and a 60 kg person really do cost the same
/// joules per kg per metre, so the linear-in-mass form is sound even though the
/// per-STEP form is not.
///
/// AND IT IS A GROSS FIGURE, which is the live inconsistency in this file. The
/// same n=205 calorimetry study measured walking at 1.34 m/s as 3.18 J·kg⁻¹·m⁻¹
/// gross against 2.22 J·kg⁻¹·m⁻¹ net — net is ~70% of gross. Converted at a
/// typical 0.65–0.75 m stride, 0.0005 kcal·step⁻¹·kg⁻¹ works out to 2.79–3.22
/// J·kg⁻¹·m⁻¹: it brackets the measured GROSS cost and sits 26–45% ABOVE the
/// measured NET one. At 70 kg that is 0.035 kcal/step here versus 0.026 measured
/// net. So steps enter the budget as a resting-inclusive number while workouts
/// now enter as an above-resting one — the very split [POPULATION_RESTING_KCAL_PER_KG_H]
/// exists to fix, still open on this side. The net-consistent value would be
/// ~0.00037; changing it cuts every user's step credit by about a quarter, so it
/// is left as an owner decision rather than slipped in here.
///
/// This also explains the residual gap between the two paths: the step model is
/// gross, the MET model is net, and the tests in bodyMetrics.test.ts bound that
/// gap at ~25% rather than asserting agreement.
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

/// Steps still priced by «шаги +N» after removing those walked INSIDE the day's
/// device-imported workout sessions — that stretch of movement is already
/// credited as the sessions' workout kcal, so pricing it again would count a
/// watch-tracked run twice (its steps AND its burn). Subtraction happens on the
/// RAW count, BEFORE [stepsEarnedKcal]'s 3000-step resting baseline. Only the
/// eating budget uses this; the step goal, wins and insights keep raw steps.
export function stepsOutsideWorkouts(daySteps: number, workoutWindowSteps: number): number {
  const s = Number.isFinite(daySteps) ? Math.max(0, daySteps) : 0;
  const w = Number.isFinite(workoutWindowSteps) ? Math.max(0, workoutWindowSteps) : 0;
  return Math.max(0, s - w);
}

/// The day's assembled eating target under «база + заработал»: the deficit base
/// (floored at the healthy day-minimum) plus today's earned activity (steps above
/// the baseline + the workout eat-back) ON TOP. Earned movement ALWAYS adds to
/// the number — it never first «pays back» a deficit that the clinical floor was
/// already overriding (device feedback 2026-07-13: «2170 без шагов и с 4000
/// шагами — так же»; the old `max(base+earned, min)` absorbed earned kcal into
/// the base→floor gap, so on a heavy profile whose deficit sits below the floor
/// small step counts moved nothing). Trade-off: two tempos that BOTH sit below
/// the floor now share the same active-day budget (they already shared the
/// couch-day one) — honest, since a deficit steeper than the floor can't happen.
export function dayBudgetKcal(baseKcal: number, minDayKcal: number, earnedKcal: number): number {
  return Math.max(baseKcal, minDayKcal) + Math.max(0, earnedKcal);
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
  /// Optional waist circumference (cm) for the device-free RFM body-fat estimate.
  /// Used ONLY when no measured body-fat % is present — a real measurement always
  /// wins. Absent / 0 / out-of-band → no estimate (plan stays on Mifflin).
  waistCm?: number;
  /// Optional BMR calibration factor from the user's measured energy balance
  /// (adaptive «Использовать мой обмен»). When plausible it OVERRIDES the formula
  /// choice: bmr = formulaBmr × factor, method 'measured'. Absent / 0 → formula.
  bmrFactor?: number;
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

  // Composition-aware BMR when we have body composition — a MEASURED body-fat %
  // first, else a waist-tape RFM estimate (device-free). Katch–McArdle uses lean
  // mass, so muscle vs fat at the same weight finally diverges; without any
  // composition we fall back to population-average Mifflin. Age is unused under
  // Katch. A real measurement always beats the tape estimate.
  const measuredFat = validBodyFatPct(profile.bodyFatPct) ? profile.bodyFatPct : null;
  const estimatedFat =
    measuredFat == null ? rfmBodyFatPct(sex, profile.heightCm, profile.waistCm ?? 0) : null;
  const effectiveFat = measuredFat ?? estimatedFat;
  const usesComposition = effectiveFat != null;
  const formulaBmr =
    effectiveFat != null
      ? katchMcArdleBmr(weightKg, effectiveFat)
      : mifflinBmr(sex, weightKg, profile.heightCm, age);
  // A measured-energy-balance factor OVERRIDES the formula choice — it's the
  // user's own number, the most accurate signal we have. It only tilts the
  // formula BMR (which still tracks weight), so it ages gracefully as they change.
  const usesMeasured = validBmrFactor(profile.bmrFactor);
  const bmr = usesMeasured ? formulaBmr * (profile.bmrFactor as number) : formulaBmr;
  const bmrMethod: BmrMethod = usesMeasured
    ? 'measured'
    : measuredFat != null
      ? 'katch'
      : estimatedFat != null
        ? 'katch-rfm'
        : 'mifflin';
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
  // The floor. Below BMI 30 it's max(BMR, clinical minimum) — the cautious
  // «don't prescribe eating under resting needs» rule. At BMI ≥ 30 it drops to
  // the CLINICAL minimum alone, for two reasons: (1) a large fat reserve supplies
  // the gap — that IS how fat loss works — and it's the same «larger reserve makes
  // a faster pace safe» logic that already justifies LOSE_FACTOR_OBESE; (2) the
  // BMR floor otherwise CANCELS that factor outright — base = BMR×1.2×0.8 =
  // BMR×0.96 is always under a BMR floor, so the obese −20% (and every 'fast'
  // −25%, = BMR×0.90) silently collapsed back to exactly BMR. The tempo lever was
  // inert for the very users it was designed for (owner feedback 2026-07-19).
  // The clinical minimum (1500 м / 1200 ж) still holds unconditionally.
  const floor = mode === 'lose' ? (bmi >= OBESE_BMI ? MIN_KCAL[sex] : Math.max(bmr, MIN_KCAL[sex])) : 0;
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
    // Under Katch–McArdle (measured OR RFM), or a measured-balance factor, age
    // doesn't drive the BMR, so an unset year isn't an assumption the number
    // rests on — don't nag for it in that case.
    assumedAge: !hasBirthYear && !usesComposition && !usesMeasured,
    bmrMethod,
  };
}

/// This user's resting rate straight from their stored profile — the practical
/// entry point for the workout math, which knows the weight but not the BMR.
/// Runs the same formula ladder the plan uses (measured factor → Katch–McArdle →
/// RFM → Mifflin), so the resting hour subtracted from a workout is the very
/// number the rest of the app calls their metabolism. An incomplete profile
/// yields the population value rather than nothing — see [restingRateFor].
export function restingRateForProfile(
  profile: BodyProfile,
  weightKg: number,
  now: Date = new Date(),
): number {
  const plan = suggestPlan(profile, weightKg, 'maintain', now);
  return restingRateFor(plan?.bmrKcal, weightKg);
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
