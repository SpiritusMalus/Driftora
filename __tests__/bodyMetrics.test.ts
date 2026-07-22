import { describe, expect, it } from '@jest/globals';

import {
  ACTIVITY_FACTORS,
  bmiCategory,
  bmiValue,
  dayBudgetKcal,
  EATBACK_FRACTION,
  katchMcArdleBmr,
  metForSpeed,
  mifflinBmr,
  MIN_PER_SET,
  POPULATION_RESTING_KCAL_PER_KG_H,
  restingPlan,
  restingRateFor,
  rfmBodyFatPct,
  setsToMinutes,
  stepsEarnedKcal,
  stepsOutsideWorkouts,
  suggestActivityLevel,
  suggestPlan,
  suggestTargets,
  supportsIntensity,
  supportsSets,
  supportsSpeed,
  validBmrFactor,
  validBodyFatPct,
  validWaistCm,
  withWorkoutEnergy,
  workoutKcal,
  WORKOUT_TYPES,
} from '@/lib/core/insights/bodyMetrics';

const NOW = new Date('2026-07-03T12:00:00Z');

describe('bmiValue', () => {
  it('computes kg/m² to one decimal', () => {
    expect(bmiValue(70, 175)).toBe(22.9); // 70 / 1.75² = 22.857…
    expect(bmiValue(90, 180)).toBe(27.8);
  });

  it('rejects implausible inputs instead of computing nonsense', () => {
    expect(bmiValue(0, 175)).toBeNull();
    expect(bmiValue(70, 0)).toBeNull();
    expect(bmiValue(70, 17)).toBeNull(); // '17' typed on the way to '175'
    expect(bmiValue(500, 175)).toBeNull();
  });
});

describe('bmiCategory (WHO bands)', () => {
  it('maps the WHO boundaries', () => {
    expect(bmiCategory(18.4)).toBe('underweight');
    expect(bmiCategory(18.5)).toBe('normal');
    expect(bmiCategory(24.9)).toBe('normal');
    expect(bmiCategory(25)).toBe('overweight');
    expect(bmiCategory(30)).toBe('obese1');
    expect(bmiCategory(35)).toBe('obese2');
    expect(bmiCategory(40)).toBe('obese3');
  });
});

describe('mifflinBmr', () => {
  it('matches the published formula for both sexes', () => {
    // 10·70 + 6.25·175 − 5·30 + 5 = 1648.75
    expect(mifflinBmr('male', 70, 175, 30)).toBeCloseTo(1648.75);
    // 10·60 + 6.25·165 − 5·30 − 161 = 1320.25
    expect(mifflinBmr('female', 60, 165, 30)).toBeCloseTo(1320.25);
  });
});

describe('katchMcArdleBmr + validBodyFatPct (composition-aware BMR)', () => {
  it('matches the published formula (370 + 21.6 × lean mass)', () => {
    // 120 kg at 15% fat → LBM 102 → 370 + 21.6·102 = 2573.2
    expect(katchMcArdleBmr(120, 15)).toBeCloseTo(2573.2);
    // 120 kg at 40% fat → LBM 72 → 370 + 21.6·72 = 1925.2
    expect(katchMcArdleBmr(120, 40)).toBeCloseTo(1925.2);
  });

  it('at the SAME weight, more muscle (lower fat%) means a higher resting burn', () => {
    expect(katchMcArdleBmr(120, 15)).toBeGreaterThan(katchMcArdleBmr(120, 40));
  });

  it('only accepts a plausible measured band; 0/guesses/garbage fall back', () => {
    expect(validBodyFatPct(20)).toBe(true);
    expect(validBodyFatPct(0)).toBe(false); // the "not set" default
    expect(validBodyFatPct(2)).toBe(false); // implausibly low
    expect(validBodyFatPct(80)).toBe(false); // implausibly high
    expect(validBodyFatPct(undefined)).toBe(false);
    expect(validBodyFatPct(NaN)).toBe(false);
  });
});

describe('rfmBodyFatPct + validWaistCm (device-free composition from a tape)', () => {
  it('matches the RFM formula for both sexes (64/76 − 20·height/waist)', () => {
    // male 180 cm, waist 90 → 64 − 20·(180/90) = 64 − 40 = 24
    expect(rfmBodyFatPct('male', 180, 90)).toBeCloseTo(24);
    // female 180 cm, waist 90 → 76 − 40 = 36
    expect(rfmBodyFatPct('female', 180, 90)).toBeCloseTo(36);
  });

  it('a smaller waist at the same height reads as less fat', () => {
    expect(rfmBodyFatPct('male', 180, 80)!).toBeLessThan(rfmBodyFatPct('male', 180, 100)!);
  });

  it('clamps into the plausible band and rejects an unusable waist', () => {
    // tall + very thin waist would go negative → clamped up to 3
    expect(rfmBodyFatPct('male', 200, 45)).toBe(3);
    expect(rfmBodyFatPct('male', 180, 0)).toBeNull(); // "not set"
    expect(rfmBodyFatPct('male', 180, 39)).toBeNull(); // below band
    expect(rfmBodyFatPct('male', 0, 90)).toBeNull(); // implausible height
  });

  it('validWaistCm gates the plausible adult band', () => {
    expect(validWaistCm(85)).toBe(true);
    expect(validWaistCm(0)).toBe(false);
    expect(validWaistCm(39)).toBe(false);
    expect(validWaistCm(201)).toBe(false);
    expect(validWaistCm(undefined)).toBe(false);
  });
});

describe('suggestPlan (waist → RFM → Katch–McArdle, device-free)', () => {
  const base = { sex: 'male', birthYear: 1991, heightCm: 180, activityLevel: 'light' };

  it('uses the waist RFM estimate when no measured % is present', () => {
    const plan = suggestPlan({ ...base, waistCm: 90 }, 120, 'maintain', NOW)!;
    // RFM 24% → LBM 91.2 → Katch 370 + 21.6·91.2 = 2339.92; method flagged apart.
    expect(plan.bmrMethod).toBe('katch-rfm');
    expect(plan.bmrKcal).toBe(Math.round(katchMcArdleBmr(120, 24)));
  });

  it('a MEASURED body-fat % always wins over the waist estimate', () => {
    const plan = suggestPlan({ ...base, bodyFatPct: 15, waistCm: 90 }, 120, 'maintain', NOW)!;
    expect(plan.bmrMethod).toBe('katch');
    expect(plan.bmrKcal).toBe(Math.round(katchMcArdleBmr(120, 15)));
  });

  it('an implausible/absent waist leaves the plan on Mifflin', () => {
    expect(suggestPlan({ ...base, waistCm: 0 }, 120, 'maintain', NOW)!.bmrMethod).toBe('mifflin');
    expect(suggestPlan({ ...base, waistCm: 10 }, 120, 'maintain', NOW)!.bmrMethod).toBe('mifflin');
  });

  it('a waist RFM estimate makes a missing birth year not an assumption (age unused)', () => {
    const plan = suggestPlan({ ...base, birthYear: 0, waistCm: 88 }, 120, 'maintain', NOW)!;
    expect(plan.bmrMethod).toBe('katch-rfm');
    expect(plan.assumedAge).toBe(false);
  });
});

describe('the deficit floor (BMR below BMI 30, clinical minimum at/above it)', () => {
  // 133 kg / 184 cm male at 38.9% fat — BMI 39.3, the owner's own numbers.
  const obese = { sex: 'male', birthYear: 1996, heightCm: 184, activityLevel: 'sedentary', bodyFatPct: 38.9 };

  it('at BMI ≥ 30 the obese −20% actually applies (BMR floor no longer cancels it)', () => {
    const plan = restingPlan(obese, 133, 'lose', NOW)!;
    // maintenance = BMR×1.2; base = ×0.8 → BMR×0.96, which a BMR floor would eat.
    expect(plan.baseKcal).toBe(Math.round((plan.bmrKcal * 1.2 * 0.8) / 10) * 10);
    expect(plan.floored).toBe(false);
    expect(plan.minDayKcal).toBe(1500); // clinical minimum, not the 2125 BMR
  });

  it('«fast» at BMI ≥ 30 is now steeper than «standard» (the lever is live again)', () => {
    const std = restingPlan(obese, 133, 'lose', NOW, 0, 'standard')!;
    const fast = restingPlan(obese, 133, 'lose', NOW, 0, 'fast')!;
    expect(fast.baseKcal).toBeLessThan(std.baseKcal);
  });

  it('below BMI 30 the BMR floor is unchanged (cautious as before)', () => {
    const lean = { sex: 'male', birthYear: 1996, heightCm: 180, activityLevel: 'sedentary' };
    const plan = restingPlan(lean, 75, 'lose', NOW, 0, 'fast')!;
    // fast = BMR×1.2×0.75 = BMR×0.9 < BMR → floored up to the BMR.
    expect(plan.floored).toBe(true);
    expect(plan.minDayKcal).toBe(Math.round(plan.bmrKcal / 10) * 10);
  });

  it('the clinical minimum still holds unconditionally at BMI ≥ 30', () => {
    // A small obese body: the −20% base would dive under 1200, so it floors there.
    const small = { sex: 'female', birthYear: 1996, heightCm: 150, activityLevel: 'sedentary' };
    const plan = restingPlan(small, 70, 'lose', NOW, 0, 'fast')!;
    expect(plan.minDayKcal).toBe(1200);
    expect(Math.max(plan.baseKcal, plan.minDayKcal)).toBeGreaterThanOrEqual(1200);
  });
});

describe('suggestPlan (measured energy-balance factor overrides the formula)', () => {
  const base = { sex: 'male', birthYear: 1991, heightCm: 180, activityLevel: 'light' };

  it('tilts the formula BMR by the factor and labels it «measured»', () => {
    const plain = suggestPlan(base, 120, 'maintain', NOW)!;
    const tuned = suggestPlan({ ...base, bmrFactor: 1.1 }, 120, 'maintain', NOW)!;
    expect(tuned.bmrMethod).toBe('measured');
    expect(tuned.bmrKcal).toBe(Math.round(plain.bmrKcal * 1.1));
  });

  it('overrides even a measured body-fat % (the user’s own burn wins)', () => {
    const tuned = suggestPlan({ ...base, bodyFatPct: 20, bmrFactor: 0.9 }, 120, 'maintain', NOW)!;
    expect(tuned.bmrMethod).toBe('measured');
    expect(tuned.bmrKcal).toBe(Math.round(katchMcArdleBmr(120, 20) * 0.9));
  });

  it('an unset/implausible factor is ignored (formula unchanged)', () => {
    expect(suggestPlan({ ...base, bmrFactor: 0 }, 120, 'maintain', NOW)!.bmrMethod).toBe('mifflin');
    expect(suggestPlan({ ...base, bmrFactor: 3 }, 120, 'maintain', NOW)!.bmrMethod).toBe('mifflin');
  });

  it('validBmrFactor gates the stored band', () => {
    expect(validBmrFactor(1.0)).toBe(true);
    expect(validBmrFactor(0)).toBe(false);
    expect(validBmrFactor(0.4)).toBe(false);
    expect(validBmrFactor(1.7)).toBe(false);
    expect(validBmrFactor(undefined)).toBe(false);
  });
});

describe('suggestPlan (body composition → Katch–McArdle)', () => {
  const base = { sex: 'male', birthYear: 1991, heightCm: 180, activityLevel: 'light' };

  it('a lean 120 kg gets a higher maintenance than a high-fat 120 kg', () => {
    const lean = suggestPlan({ ...base, bodyFatPct: 15 }, 120, 'maintain', NOW)!;
    const fat = suggestPlan({ ...base, bodyFatPct: 40 }, 120, 'maintain', NOW)!;
    expect(lean.bmrMethod).toBe('katch');
    expect(fat.bmrMethod).toBe('katch');
    expect(lean.maintenanceKcal).toBeGreaterThan(fat.maintenanceKcal);
  });

  it('without a measured body-fat % it stays on Mifflin (unchanged behaviour)', () => {
    const plan = suggestPlan(base, 120, 'maintain', NOW)!;
    expect(plan.bmrMethod).toBe('mifflin');
    const guessed = suggestPlan({ ...base, bodyFatPct: 0 }, 120, 'maintain', NOW)!;
    expect(guessed.bmrMethod).toBe('mifflin');
  });

  it('under Katch–McArdle a missing birth year is NOT flagged as an assumption (age unused)', () => {
    const plan = suggestPlan({ ...base, birthYear: 0, bodyFatPct: 18 }, 120, 'maintain', NOW)!;
    expect(plan.bmrMethod).toBe('katch');
    expect(plan.assumedAge).toBe(false);
  });
});

describe('suggestTargets', () => {
  const profile = { sex: 'male', birthYear: 1996, heightCm: 175, activityLevel: 'sedentary' };

  it('returns maintenance КБЖУ rounded honestly', () => {
    const s = suggestTargets(profile, 70, NOW)!;
    // BMR 1648.75 × 1.2 = 1978.5 → 1980 (nearest 10)
    expect(s.kcal).toBe(1980);
    expect(s.prot).toBe(112); // 1.6 g/kg
    expect(s.fat).toBe(66); // 30% kcal / 9
    // remainder: (1980 − 112·4 − 66·9) / 4
    expect(s.carb).toBe(Math.round((1980 - 112 * 4 - 66 * 9) / 4));
  });

  it('scales with the activity factor', () => {
    const high = suggestTargets({ ...profile, activityLevel: 'high' }, 70, NOW)!;
    expect(high.kcal).toBe(Math.round((1648.75 * ACTIVITY_FACTORS.high) / 10) * 10);
    expect(high.kcal).toBeGreaterThan(1980);
  });

  it('stays null until the profile is complete and plausible', () => {
    expect(suggestTargets({ ...profile, sex: '' }, 70, NOW)).toBeNull();
    expect(suggestTargets({ ...profile, activityLevel: '' }, 70, NOW)).toBeNull();
    // birthYear 0 (unset) no longer blocks the plan — it falls back to a neutral
    // adult age (see the assumed-age test below). But an implausible SET year still does.
    expect(suggestTargets({ ...profile, birthYear: 2020 }, 70, NOW)).toBeNull(); // age 6
    expect(suggestTargets({ ...profile, heightCm: 0 }, 70, NOW)).toBeNull();
    expect(suggestTargets(profile, 0, NOW)).toBeNull(); // no weight logged yet
  });

  it('an unset birth year gives a flagged estimate instead of hiding the plan', () => {
    const noYear = { ...profile, birthYear: 0 };
    const plan = suggestPlan(noYear, 70, 'maintain', NOW);
    expect(plan).not.toBeNull();
    expect(plan!.assumedAge).toBe(true);
    // A real year drives an un-flagged plan; the assumed-age one is close (age
    // moves BMR only a little), not wildly off.
    const real = suggestPlan(profile, 70, 'maintain', NOW)!;
    expect(real.assumedAge).toBe(false);
    expect(Math.abs(plan!.kcal - real.kcal)).toBeLessThan(200);
  });
});

describe('suggestPlan (goal modes)', () => {
  const profile = { sex: 'male', birthYear: 1996, heightCm: 175, activityLevel: 'sedentary' };

  it('maintain equals the legacy maintenance targets, pace 0', () => {
    const plan = suggestPlan(profile, 70, 'maintain', NOW)!;
    const legacy = suggestTargets(profile, 70, NOW)!;
    expect(plan.kcal).toBe(legacy.kcal);
    expect(plan.prot).toBe(legacy.prot);
    expect(plan.fat).toBe(legacy.fat);
    expect(plan.carb).toBe(legacy.carb);
    expect(plan.paceKgPerWeek).toBe(0);
    expect(plan.floored).toBe(false);
  });

  it('lose = −15% of maintenance, protein raised to 1.8 g/kg, honest pace', () => {
    const plan = suggestPlan(profile, 70, 'lose', NOW)!;
    // maintenance 1978.5 → −15% = 1681.7 → 1680; floors (BMR 1648.75, 1500) don't bind.
    expect(plan.kcal).toBe(1680);
    expect(plan.maintenanceKcal).toBe(1980);
    expect(plan.floored).toBe(false);
    expect(plan.prot).toBe(Math.round(1.8 * 70));
    // (1980 − 1680) × 7 / 7700 ≈ 0.27 → 0.3 kg/week
    expect(plan.paceKgPerWeek).toBe(0.3);
  });

  it('gain = +10% of maintenance with a positive pace', () => {
    const plan = suggestPlan(profile, 70, 'gain', NOW)!;
    // maintenance 1978.5 → +10% = 2176.35 → 2180.
    expect(plan.kcal).toBe(2180);
    expect(plan.kcal).toBeGreaterThan(plan.maintenanceKcal);
    expect(plan.paceKgPerWeek).toBeGreaterThan(0);
  });

  it('never prescribes below BMR: the deficit is floored, honestly flagged', () => {
    // Sedentary male: BMR 1648.75, TDEE ×1.2 = 1978.5. −15% (1681.7) is above
    // BMR, so use "light" female with small margins instead: BMR 1320.25,
    // TDEE ×1.2 = 1584.3, −15% = 1346.7 → BELOW BMR 1320? No: 1346 > 1320.
    // Take an older, shorter female where the cut lands under the 1200 floor.
    const small = { sex: 'female', birthYear: 1966, heightCm: 150, activityLevel: 'sedentary' };
    const plan = suggestPlan(small, 45, 'lose', NOW)!;
    // BMR = 450 + 937.5 − 300 − 161 = 926.5; TDEE = 1111.8; −15% = 945 → floor 1200.
    expect(plan.kcal).toBe(1200);
    expect(plan.floored).toBe(true);
    // Floor sits ABOVE maintenance here — pace clamps to 0, never reads as gain.
    expect(plan.paceKgPerWeek).toBe(0);
  });

  it('carbs never go negative when protein+fat outweigh a floored budget', () => {
    const small = { sex: 'female', birthYear: 1966, heightCm: 150, activityLevel: 'sedentary' };
    const plan = suggestPlan(small, 45, 'lose', NOW)!;
    expect(plan.carb).toBeGreaterThanOrEqual(0);
    expect(plan.prot).toBe(Math.round(1.8 * 45));
  });

  it('states a fiber guideline scaled to the kcal budget (14 g / 1000 kcal)', () => {
    const plan = suggestPlan(profile, 70, 'maintain', NOW)!;
    expect(plan.fiber).toBe(Math.round((plan.kcal * 14) / 1000)); // 1980 → 28 g
    expect(plan.fiber).toBe(28);
  });
});

describe('suggestPlan (goal weight + high-BMI precision)', () => {
  // The prod question that drove this: 130 kg wanting 90 — «белков может быть
  // меньше нужно потреблять?». Male, 180 cm, 35 y.o., light activity.
  const heavy = { sex: 'male', birthYear: 1991, heightCm: 180, activityLevel: 'light' };

  it('130 kg → goal 90: protein from the GOAL weight, deficit −20% at BMI ≥ 30', () => {
    const plan = suggestPlan(heavy, 130, 'lose', NOW, 90)!;
    // BMR 2255 × 1.375 = 3100.6; BMI 40 ≥ 30 → −20%: 2480.5 → 2480 (floors don't bind).
    expect(plan.maintenanceKcal).toBe(3100);
    expect(plan.kcal).toBe(2480);
    expect(plan.floored).toBe(false);
    // Protein from 90 kg, NOT 130: 1.8 × 90 = 162 g (234 g would be неподъёмно).
    expect(plan.prot).toBe(162);
    expect(plan.proteinBasis).toBe('goal');
    expect(plan.proteinBasisKg).toBe(90);
    // Fiber against deficit hunger: 14 g/1000 kcal of the actual budget.
    expect(plan.fiber).toBe(35);
    // Honest ETA: 620 kcal/day gap → 0.6 kg/week → 40 kg ≈ 67 weeks.
    expect(plan.paceKgPerWeek).toBe(0.6);
    expect(plan.etaWeeks).toBe(67);
  });

  it('no goal set at BMI ≥ 30: falls back to the clinical adjusted body weight', () => {
    const plan = suggestPlan(heavy, 130, 'lose', NOW)!;
    // IBW@BMI25 = 25 × 1.8² = 81; adjusted = 81 + 0.4 × (130 − 81) = 100.6 kg.
    expect(plan.proteinBasis).toBe('adjusted');
    expect(plan.proteinBasisKg).toBe(101);
    expect(plan.prot).toBe(181); // 1.8 × 100.6
    expect(plan.etaWeeks).toBeNull(); // no goal → no ETA
  });

  it('below BMI 30 the current weight stays the basis and the deficit stays −15%', () => {
    const plan = suggestPlan(heavy, 90, 'lose', NOW)!; // BMI 27.8
    expect(plan.proteinBasis).toBe('current');
    expect(plan.prot).toBe(Math.round(1.8 * 90));
    // BMR 1855 × 1.375 = 2550.6 → −15% = 2168 → 2170.
    expect(plan.kcal).toBe(2170);
  });

  it('a goal below the healthy band is clamped to weight@BMI 18.5', () => {
    const plan = suggestPlan(heavy, 90, 'lose', NOW, 40)!;
    // 18.5 × 1.8² = 59.94 — never plan a body below the healthy floor.
    expect(plan.proteinBasis).toBe('goal');
    expect(plan.proteinBasisKg).toBe(60);
    expect(plan.prot).toBe(Math.round(1.8 * 59.94));
  });

  it('a goal pointing the wrong way for the mode is ignored', () => {
    const up = suggestPlan(heavy, 130, 'lose', NOW, 140)!; // "lose to 140" — nonsense
    expect(up.proteinBasis).toBe('adjusted'); // falls back as if unset
    expect(up.etaWeeks).toBeNull();
    const maintain = suggestPlan(heavy, 130, 'maintain', NOW, 90)!;
    expect(maintain.proteinBasis).toBe('current');
    expect(maintain.etaWeeks).toBeNull();
  });

  it('gain with a higher goal keeps protein from the current weight but gets an ETA', () => {
    const slim = { sex: 'male', birthYear: 1996, heightCm: 175, activityLevel: 'sedentary' };
    const plan = suggestPlan(slim, 70, 'gain', NOW, 75)!;
    expect(plan.proteinBasis).toBe('current');
    expect(plan.prot).toBe(Math.round(1.6 * 70));
    // +200 kcal/day → 0.2 kg/week → 5 kg ≈ 25 weeks.
    expect(plan.paceKgPerWeek).toBe(0.2);
    expect(plan.etaWeeks).toBe(25);
  });
});

describe('workoutKcal ((MET − resting) × kg × hours — the ACTIVE cost)', () => {
  it('computes a running session for a heavy person', () => {
    // run 9.3 MET (Compendium 2024, 12050) minus the population resting rate
    // 0.84 → 8.46 × 130 kg × 0.5 h = 550
    expect(workoutKcal('run', 30, 130)).toBe(550);
  });

  it('scales with duration and clamps garbage input', () => {
    expect(workoutKcal('walk', 0, 130)).toBe(0);
    expect(workoutKcal('walk', 60, 130)).toBe(515); // (4.8 − 0.84) × 130 × 1
    expect(workoutKcal('run', -5, 130)).toBe(0); // negative minutes floored
    expect(Number.isFinite(workoutKcal('run', 30, 0))).toBe(true); // weight clamps, no NaN
  });

  it('every listed type has a MET value (no zeros from a missing map entry)', () => {
    for (const t of WORKOUT_TYPES) {
      expect(workoutKcal(t, 30, 80)).toBeGreaterThan(0);
    }
  });

  it('the resting hour is not billed as exercise', () => {
    // An hour of yoga (2.3 MET) is an hour of being alive (0.84) plus 1.46 of
    // actual effort — charging all 2.3 would bill the budget twice for the same
    // resting metabolism its base already covers.
    expect(workoutKcal('yoga', 60, 80)).toBe(117); // 1.46 × 80, not 2.3 × 80 = 184
    // The lighter the activity, the larger the share that was resting: yoga is
    // 37% resting, running only 9%.
    expect(workoutKcal('run', 60, 80)).toBe(677); // 8.46 × 80, not 9.3 × 80 = 744
  });

  it('carries no afterburn — the evidence could not size one', () => {
    // strength: (3.5 − 0.84) × 80 × 1 h = 213, with nothing added on top.
    // The old +10% rested on a 6–15% figure that applies to protocols far harder
    // than a typical session, on «no data» for resistance work, and on a review
    // whose own spread was 4.1–114 kcal. See POPULATION_RESTING_KCAL_PER_KG_H.
    expect(workoutKcal('strength', 60, 80)).toBe(213);
    // hiit: (7.5 − 0.84) × 80 × 0.5 h = 266 — no bonus, and no strength/cardio
    // split either (measured EPOC after steady running matches interval work).
    expect(workoutKcal('hiit', 30, 80)).toBe(266);
    expect(workoutKcal('walk', 60, 130)).toBe(515);
  });

  it('uses the user’s OWN resting rate when the caller knows their BMR', () => {
    // Byrne 2005's recommendation: individual RMR as the correction factor.
    // A 120 kg user with a 2000 kcal BMR rests at 2000/(120×24) = 0.69 kcal/kg/h,
    // well under the 0.84 population value — subtracting a flat 1.0 (the old
    // constant) would have over-corrected them by nearly a third.
    const heavy = restingRateFor(2000, 120);
    expect(heavy).toBeCloseTo(0.694, 3);
    // Their hour of walking therefore costs MORE than the population default
    // says, not less: (4.8 − 0.69) vs (4.8 − 0.84).
    expect(workoutKcal('walk', 60, 120, null, null, heavy)).toBeGreaterThan(
      workoutKcal('walk', 60, 120),
    );
  });

  it('falls back to the population rate only when there is no personal number', () => {
    expect(restingRateFor(undefined, 80)).toBe(POPULATION_RESTING_KCAL_PER_KG_H);
    expect(restingRateFor(2000, undefined)).toBe(POPULATION_RESTING_KCAL_PER_KG_H);
    expect(restingRateFor(0, 80)).toBe(POPULATION_RESTING_KCAL_PER_KG_H);
    expect(restingRateFor(NaN, 80)).toBe(POPULATION_RESTING_KCAL_PER_KG_H);
  });

  it('clamps an out-of-band rate instead of jumping to the population value', () => {
    // A 6000 kcal "BMR" on a 70 kg body is 3.6 kcal/kg/h — clamped to the ceiling.
    expect(restingRateFor(6000, 70)).toBe(1.2);
    // The failure that mattered: a 130 kg user on a low adaptive factor. BMR 1539
    // gives 0.49, a hair under the floor. Answering 0.84 there would hand the
    // LOWEST measured metabolism the LARGEST resting subtraction.
    expect(restingRateFor(1539, 130)).toBe(0.5);
    expect(restingRateFor(1539, 130)).toBeLessThan(POPULATION_RESTING_KCAL_PER_KG_H);
  });

  it('is monotone in BMR — a lower metabolism never costs the user more', () => {
    // The property the clamp exists to preserve: walking the BMR down must never
    // raise the subtraction, at any weight.
    for (const kg of [60, 80, 100, 130, 160]) {
      let prev = -Infinity;
      for (const bmr of [900, 1100, 1300, 1539, 1760, 2200, 2600, 3200]) {
        const rate = restingRateFor(bmr, kg);
        expect(rate).toBeGreaterThanOrEqual(prev);
        prev = rate;
      }
    }
  });

  it('never penalises a heavier user for logging a walk', () => {
    // The same 6000 steps of walking, priced two ways: as a logged workout
    // (Compendium MET, personal resting rate, EATBACK_FRACTION, its own steps
    // subtracted) versus left to the pedometer (per-step constant, full credit).
    //
    // They do not match exactly and cannot: the step model has no idea how fast
    // you walked, and at the app's brisk MET the two agree only near 100 steps
    // per minute. What MUST hold is the direction — the gap has to be bounded,
    // and it has to shrink rather than grow with body mass, because that is the
    // regime where the resting subtraction and the step constant are both least
    // certain. Measured at 115 steps/min: −25% at 50 kg, −19% at 80, −15% at
    // 130, −13% at 200. Heavier users are treated BETTER by this pair, not worse.
    const STEPS = 6000;
    const MINUTES = Math.round(STEPS / 115);
    let previousGap = Infinity;
    for (const kg of [50, 60, 80, 100, 130, 160, 200]) {
      const rate = restingRateFor(mifflinBmr('male', kg, 175, 40), kg);
      const asSteps = stepsEarnedKcal(STEPS + 3000, kg) - stepsEarnedKcal(3000, kg);
      const asWorkout = Math.round(workoutKcal('walk', MINUTES, kg, null, null, rate) * EATBACK_FRACTION);
      const gap = Math.abs(asWorkout - asSteps) / asSteps;
      expect(gap).toBeLessThan(0.27);
      expect(gap).toBeLessThanOrEqual(previousGap + 0.001); // monotone in weight
      previousGap = gap;
    }
  });

  it('agrees between the two models at the pace the step constant implies', () => {
    // 6000 steps at ~100 steps/min is an hour of moderate walking, and there the
    // Compendium path and the per-step path land within a few percent of each
    // other at every weight — including 130 kg, where an earlier version of this
    // model diverged badly. This is the smoke test for retuning either side.
    for (const kg of [60, 80, 130, 160]) {
      const rate = restingRateFor(mifflinBmr('male', kg, 175, 40), kg);
      const asSteps = stepsEarnedKcal(9000, kg) - stepsEarnedKcal(3000, kg);
      const asWorkout = Math.round(workoutKcal('walk', 60, kg, null, null, rate) * EATBACK_FRACTION);
      expect(Math.abs(asWorkout - asSteps) / asSteps).toBeLessThan(0.13);
    }
  });

  it('lands on the measured resting rate for a severely obese adult', () => {
    // Mifflin for a 130 kg / 175 cm / 40 y man → BMR 2199 → 0.705 kcal·kg⁻¹·h⁻¹.
    // Direct measurement in 1331 adults at mean BMI 42.5 puts true resting at
    // ~0.71 (women) / ~0.75 (men) — the formula ladder lands inside that band,
    // where the old flat 1.0 was ~40% too high for exactly these users.
    const bmr = mifflinBmr('male', 130, 175, 40);
    const rate = restingRateFor(bmr, 130);
    expect(rate).toBeGreaterThan(0.65);
    expect(rate).toBeLessThan(0.8);
    // And the composition-aware path agrees rather than diverging.
    const fat = rfmBodyFatPct('male', 175, 130);
    expect(restingRateFor(katchMcArdleBmr(130, fat as number), 130)).toBeGreaterThan(0.6);
  });

  it('the population resting rate is the measured one, not the 1.0 convention', () => {
    // Byrne 2005, 769 adults: 0.84 ± 0.16 kcal/kg/h measured, against the
    // Compendium's 1 MET = 1 kcal/kg/h convention.
    expect(POPULATION_RESTING_KCAL_PER_KG_H).toBe(0.84);
  });
});

describe('sets-based strength logging (no stopwatch needed)', () => {
  it('only strength is logged in sets', () => {
    expect(supportsSets('strength')).toBe(true);
    expect(supportsSets('hiit')).toBe(false);
    expect(supportsSets('run')).toBe(false);
  });

  it('sets → minutes at ~3 min per set, clamped against typos', () => {
    expect(setsToMinutes(12)).toBe(12 * MIN_PER_SET); // 36
    expect(setsToMinutes(0)).toBe(0);
    expect(setsToMinutes(-3)).toBe(0);
    expect(setsToMinutes(300)).toBe(60 * MIN_PER_SET); // a typo can't triple the day
    expect(setsToMinutes(NaN)).toBe(0);
  });

  it('a 12-set gym session lands on a plausible burn for 80 kg', () => {
    // 12 × 3 min = 36 min → (3.5 − 0.84) × 80 × 0.6 = 128 active, nothing added
    // on top. Trackers report ACTIVE energy, which is what this now is.
    expect(workoutKcal('strength', setsToMinutes(12), 80)).toBe(128);
  });
});

describe('strength effort → MET (light/moderate/heavy)', () => {
  it('offers an effort chip for strength only', () => {
    expect(supportsIntensity('strength')).toBe(true);
    expect(supportsIntensity('run')).toBe(false);
    expect(supportsIntensity('hiit')).toBe(false);
  });

  it('effort picks the MET; heavy lifting no longer reads as a light 3.5 session', () => {
    const min = setsToMinutes(12); // 36 min
    // Compendium 2024 codes 02054 / 02052 / 02050 — light 3.5, moderate 5.0,
    // heavy 6.0, each minus the 0.84 resting rate, × 80 kg × 0.6 h.
    expect(workoutKcal('strength', min, 80, null, 'light')).toBe(128);
    expect(workoutKcal('strength', min, 80, null, 'moderate')).toBe(200);
    expect(workoutKcal('strength', min, 80, null, 'heavy')).toBe(248);
    // No effort passed → the fixed moderate MET (3.5), unchanged from before.
    expect(workoutKcal('strength', min, 80)).toBe(128);
  });

  it('effort is a strength-only lever — ignored for other types', () => {
    // A pace-less run keeps its fixed 9.8 MET regardless of an effort argument.
    expect(workoutKcal('run', 30, 130, null, 'heavy')).toBe(workoutKcal('run', 30, 130));
  });
});

describe('metForSpeed + speed-aware workoutKcal', () => {
  it('only walk/run/cycle support a pace', () => {
    expect(supportsSpeed('walk')).toBe(true);
    expect(supportsSpeed('run')).toBe(true);
    expect(supportsSpeed('cycle')).toBe(true);
    expect(supportsSpeed('strength')).toBe(false);
    expect(supportsSpeed('yoga')).toBe(false);
  });

  it('returns null for a type/speed it cannot refine (caller falls back to fixed MET)', () => {
    expect(metForSpeed('strength', 12)).toBeNull();
    expect(metForSpeed('run', 0)).toBeNull();
    expect(metForSpeed('run', NaN)).toBeNull();
  });

  it('a faster run burns more than the fixed moderate MET, a slower run less', () => {
    const fixed = workoutKcal('run', 30, 130); // 637 at the 9.8 MET default
    expect(workoutKcal('run', 30, 130, 12)).toBeGreaterThan(fixed); // ~11.4 MET
    expect(workoutKcal('run', 30, 130, 8)).toBeLessThan(fixed); // 8.3 MET
  });

  it('ignores a pace on a non-speed type (uses fixed MET)', () => {
    expect(workoutKcal('strength', 30, 80, 10)).toBe(workoutKcal('strength', 30, 80));
  });

  it('clamps an absurd pace instead of returning NaN', () => {
    const met = metForSpeed('run', 999);
    expect(met).not.toBeNull();
    expect(Number.isFinite(met as number)).toBe(true);
    expect(met as number).toBeLessThan(30);
  });

  // Accuracy audit 2026-07-10: pace-aware METs must sit ON the Compendium
  // anchors, not the ACSM treadmill equations (which underestimated fast
  // walking by ~40% and made a typed pace DROP below the untyped default).
  it('walking METs match the Compendium anchors, brisk pace = the fixed default', () => {
    expect(metForSpeed('walk', 4.8)).toBeCloseTo(3.8, 5); // 2.8–3.4 mph (17190)
    expect(metForSpeed('walk', 5.6)).toBeCloseTo(4.8, 5); // brisk — SAME as no-pace walk
    expect(metForSpeed('walk', 6.4)).toBeCloseTo(5.5, 5); // 4.0–4.4 mph (17220)
    expect(metForSpeed('walk', 7.2)).toBeCloseTo(7.0, 5); // fast walking, ACSM gave ~4.4
    expect(metForSpeed('walk', 8.0)).toBeCloseTo(8.3, 5);
    // Between anchors: linear (6.8 sits halfway between 5.5 and 7.0).
    expect(metForSpeed('walk', 6.8)).toBeCloseTo(6.25, 5);
    // Typing an honest pace never lowers a brisk default anymore.
    expect(workoutKcal('walk', 60, 100, 5.6)).toBe(workoutKcal('walk', 60, 100));
  });

  it('running METs match the Compendium anchors', () => {
    expect(metForSpeed('run', 8.0)).toBeCloseTo(8.5, 5); // 5 mph (12030)
    expect(metForSpeed('run', 9.7)).toBeCloseTo(9.3, 5); // 6–6.3 mph (12050)
    expect(metForSpeed('run', 12.9)).toBeCloseTo(11.8, 5); // ACSM gave ~13.3
    expect(metForSpeed('run', 5)).toBeCloseTo(6.0, 5); // below the table → slowest anchor
  });

  it('cycling fit passes through the Compendium bucket midpoints', () => {
    expect(metForSpeed('cycle', 20)).toBeCloseTo(8.0, 5); // 19–22 km/h moderate
    expect(metForSpeed('cycle', 24)).toBeCloseTo(10.0, 5); // 22.5–25.6 vigorous
    expect(metForSpeed('cycle', 10)).toBeCloseTo(4.0, 5); // leisure floor
  });
});

describe('withWorkoutEnergy (eat-back layered onto a base)', () => {
  it('adds only EATBACK_FRACTION of the burn, rounded to 10', () => {
    // 0.72 = measured additivity, not a chosen margin: in the largest paired
    // doubly-labelled-water dataset (n = 1754) the total-on-basal slope is
    // 0.723, 95% CI [0.626, 0.820] — an interval that excludes both 1.0 and the
    // 0.9 this used to be.
    expect(EATBACK_FRACTION).toBe(0.72);
    // 2540 + 0.72 × 600 = 2972 → 2970
    expect(withWorkoutEnergy(2540, 600)).toBe(2970);
  });

  it('a zero/negative burn leaves the base untouched (rounded to 10)', () => {
    expect(withWorkoutEnergy(2540, 0)).toBe(2540);
    expect(withWorkoutEnergy(2540, -100)).toBe(2540);
  });
});

describe('suggestPlan (deficit tempo: the pace lever)', () => {
  // Male 130 kg, 180 cm, 35 y.o., light activity — maintenance 3100 kcal, BMI 40.
  const heavy = { sex: 'male', birthYear: 1991, heightCm: 180, activityLevel: 'light' };

  it("defaults to 'standard', which reproduces the pre-choice BMI-aware plan", () => {
    const omitted = suggestPlan(heavy, 130, 'lose', NOW, 90)!;
    const explicit = suggestPlan(heavy, 130, 'lose', NOW, 90, 'standard')!;
    expect(omitted.kcal).toBe(explicit.kcal);
    expect(explicit.kcal).toBe(2480); // BMI ≥ 30 → −20%, same as before the lever existed
  });

  it('soft eases the deficit (−10%), fast steepens it (−25%)', () => {
    const soft = suggestPlan(heavy, 130, 'lose', NOW, 90, 'soft')!;
    const standard = suggestPlan(heavy, 130, 'lose', NOW, 90, 'standard')!;
    const fast = suggestPlan(heavy, 130, 'lose', NOW, 90, 'fast')!;
    // 3100.6 × {0.9, 0.8, 0.75} → 2790 / 2480 / 2330 (floors don't bind here).
    expect(soft.kcal).toBe(2790);
    expect(standard.kcal).toBe(2480);
    expect(fast.kcal).toBe(2330);
    expect(soft.kcal).toBeGreaterThan(standard.kcal);
    expect(fast.kcal).toBeLessThan(standard.kcal);
    // Faster deficit → faster expected pace.
    expect(fast.paceKgPerWeek).toBeGreaterThan(soft.paceKgPerWeek);
  });

  it('the clinical floor still caps fast on a small body (no crash diet)', () => {
    const small = { sex: 'female', birthYear: 1966, heightCm: 150, activityLevel: 'sedentary' };
    const standard = suggestPlan(small, 45, 'lose', NOW, 0, 'standard')!;
    const fast = suggestPlan(small, 45, 'lose', NOW, 0, 'fast')!;
    // Both floor to the female clinical minimum (1200) — fast can't push below it.
    expect(fast.floored).toBe(true);
    expect(fast.kcal).toBe(standard.kcal);
    expect(fast.kcal).toBeGreaterThanOrEqual(1200);
  });

  it('tempo is ignored for maintain (no pace to size)', () => {
    const std = suggestPlan(heavy, 130, 'maintain', NOW, 0, 'standard')!;
    const fast = suggestPlan(heavy, 130, 'maintain', NOW, 0, 'fast')!;
    expect(fast.kcal).toBe(std.kcal);
  });

  it('gain tempo sizes the surplus: +5% / +10% / +15%', () => {
    const soft = suggestPlan(heavy, 130, 'gain', NOW, 0, 'soft')!;
    const standard = suggestPlan(heavy, 130, 'gain', NOW, 0, 'standard')!;
    const fast = suggestPlan(heavy, 130, 'gain', NOW, 0, 'fast')!;
    // 3100.6 × {1.05, 1.10, 1.15} → 3260 / 3410 / 3570. 'standard' reproduces
    // the pre-lever +10%, so an untouched setting keeps the old plan.
    expect(soft.kcal).toBe(3260);
    expect(standard.kcal).toBe(3410);
    expect(fast.kcal).toBe(3570);
    // A bolder surplus → a faster expected gain pace.
    expect(fast.paceKgPerWeek).toBeGreaterThan(soft.paceKgPerWeek);
  });
});

describe('suggestActivityLevel (steps → lifestyle multiplier)', () => {
  it('maps step bands to levels', () => {
    expect(suggestActivityLevel(3000)).toBe('sedentary');
    expect(suggestActivityLevel(6000)).toBe('light');
    expect(suggestActivityLevel(9000)).toBe('moderate');
    expect(suggestActivityLevel(13000)).toBe('high');
  });
});

describe('stepsEarnedKcal (base+earned: steps only ever ADD)', () => {
  it('earns nothing at/below the resting baseline (never subtracts)', () => {
    expect(stepsEarnedKcal(3000, 80)).toBe(0);
    expect(stepsEarnedKcal(1000, 80)).toBe(0);
    expect(stepsEarnedKcal(0, 80)).toBe(0);
  });

  it('adds real walking energy above the baseline, scaling with steps and weight', () => {
    // (5000−3000) × 0.0005 × 80 = 80 — a gentle, visible add for 5k steps
    expect(stepsEarnedKcal(5000, 80)).toBe(80);
    expect(stepsEarnedKcal(12000, 80)).toBe(360);
    expect(stepsEarnedKcal(12000, 80)).toBeGreaterThan(stepsEarnedKcal(5000, 80)); // more steps → more
    expect(stepsEarnedKcal(12000, 120)).toBeGreaterThan(stepsEarnedKcal(12000, 80)); // heavier → more
  });

  it('clamps garbage input, never NaN', () => {
    expect(stepsEarnedKcal(NaN, 80)).toBe(0);
    expect(Number.isFinite(stepsEarnedKcal(12000, 0))).toBe(true); // weight clamps up to 20
  });
});

describe('restingPlan (the «база» — sedentary regardless of stored level)', () => {
  it('ignores the stored activity level, always computing at the sedentary factor', () => {
    const moderate = { sex: 'male', birthYear: 1991, heightCm: 180, activityLevel: 'moderate' };
    const rest = restingPlan(moderate, 90, 'maintain', NOW)!;
    const sedentary = suggestPlan({ ...moderate, activityLevel: 'sedentary' }, 90, 'maintain', NOW)!;
    expect(rest.kcal).toBe(sedentary.kcal);
    // The resting base is below the person's moderate maintenance — steps/workouts
    // are added ON TOP, so activity always adds and is never double-counted.
    const asModerate = suggestPlan(moderate, 90, 'maintain', NOW)!;
    expect(rest.kcal).toBeLessThan(asModerate.kcal);
  });
});

describe('dayBudgetKcal (earned movement adds on top of the floored base)', () => {
  it('floors the base at the day-minimum, then adds earned kcal ON TOP', () => {
    expect(dayBudgetKcal(2080, 2170, 455)).toBe(2625); // base under floor → floor + earned
    expect(dayBudgetKcal(2080, 2170, 0)).toBe(2170); // couch day rests at the minimum
    expect(dayBudgetKcal(2080, 2170, 50)).toBe(2220); // ANY movement now raises the number
    expect(dayBudgetKcal(2340, 2170, 100)).toBe(2440); // base above min: plain sum
  });

  it('never counts negative earned kcal', () => {
    expect(dayBudgetKcal(2000, 0, -300)).toBe(2000);
  });
});

// The endocrinology regression that drove the day-level floor: male, 30 y.o.,
// 130 kg at a MEASURED 36 % body fat, walking ~10k steps. Reference numbers an
// endocrinologist computes by hand: LBM 83.2 kg → Katch–McArdle BMR ≈ 2167;
// sedentary-day burn ≈ 2600; day burn with 10k steps ≈ 3055 (band 3050–3150).
describe('130 kg / 36 % fat / 10k steps — matches the by-hand clinical numbers', () => {
  const profile = { sex: 'male', birthYear: 1996, heightCm: 175, activityLevel: 'moderate', bodyFatPct: 36 };

  it('BMR comes from lean mass (Katch–McArdle), not total weight', () => {
    const rest = restingPlan(profile, 130, 'maintain', NOW)!;
    expect(rest.bmrMethod).toBe('katch');
    expect(rest.bmrKcal).toBe(2167); // 370 + 21.6 × 83.2
    expect(rest.kcal).toBe(2600); // ×1.2 — a no-movement day
  });

  it('maintenance budget with 10k steps lands in the clinical 3050–3150 band', () => {
    const rest = restingPlan(profile, 130, 'maintain', NOW)!;
    const earned = stepsEarnedKcal(10_000, 130);
    expect(earned).toBe(455); // (10000 − 3000) × 0.0005 × 130
    expect(rest.kcal + earned).toBe(3055);
  });

  it('earned movement adds on top, and at BMI ≥ 30 every tempo stays distinct', () => {
    const earned = stepsEarnedKcal(10_000, 130);
    const soft = restingPlan(profile, 130, 'lose', NOW, 0, 'soft')!;
    const standard = restingPlan(profile, 130, 'lose', NOW, 0, 'standard')!;
    const fast = restingPlan(profile, 130, 'lose', NOW, 0, 'fast')!;
    // BMI 42.4 → the floor is the CLINICAL minimum (1500), not the BMR. Before
    // 2026-07-19 a BMR floor (2170) swallowed both −20 % and −25 %, so the two
    // steepest tempos collapsed onto the same number and the obese factor was
    // inert — exactly the users it was written for felt no lever at all.
    expect(standard.floored).toBe(false);
    expect(fast.floored).toBe(false);
    expect(standard.kcal).toBe(2080);
    expect(standard.minDayKcal).toBe(1500);
    // The bases are unchanged; what changed is that they now SURVIVE to the budget.
    expect(soft.baseKcal).toBe(2340);
    expect(standard.baseKcal).toBe(2080);
    expect(fast.baseKcal).toBe(1950);
    // Earned movement adds ON TOP (device feedback 2026-07-13: «2170 без шагов и с
    // 4000 шагами — так же»), and all three tempos now differ.
    const budgets = [soft, standard, fast].map((p) => dayBudgetKcal(p.baseKcal, p.minDayKcal, earned));
    expect(budgets).toEqual([2795, 2535, 2405]);
    // A zero-movement day still never dips below the clinical minimum.
    expect(dayBudgetKcal(fast.baseKcal, fast.minDayKcal, 0)).toBe(1950);
    expect(dayBudgetKcal(fast.baseKcal, fast.minDayKcal, 0)).toBeGreaterThanOrEqual(1500);
  });

  it('for maintain/gain the minimum is absent (0) and base equals the target', () => {
    const rest = restingPlan(profile, 130, 'maintain', NOW)!;
    expect(rest.minDayKcal).toBe(0);
    expect(rest.baseKcal).toBe(rest.kcal);
  });
});

describe('stepsOutsideWorkouts (steps↔workout double-count fix)', () => {
  it('subtracts the workout-window steps from the raw count', () => {
    expect(stepsOutsideWorkouts(8000, 1200)).toBe(6800);
    expect(stepsOutsideWorkouts(8000, 0)).toBe(8000);
  });

  it('never goes negative and shrugs off garbage', () => {
    expect(stepsOutsideWorkouts(2000, 5000)).toBe(0); // window > day (clock skew)
    expect(stepsOutsideWorkouts(NaN, 100)).toBe(0);
    expect(stepsOutsideWorkouts(5000, NaN)).toBe(5000);
    expect(stepsOutsideWorkouts(-100, -50)).toBe(0);
  });

  it('composes with stepsEarnedKcal: subtraction lands BEFORE the 3000 baseline', () => {
    // 82 kg, 8000 steps of which 1200 inside an imported run:
    // (8000 − 1200 − 3000) × 0.0005 × 82 = 155.8 → 156 kcal.
    expect(stepsEarnedKcal(stepsOutsideWorkouts(8000, 1200), 82)).toBe(156);
    // Without the fix the same day priced (8000 − 3000) × 0.0005 × 82 = 205 —
    // and the run's kcal would ride on top: the double count this kills.
    expect(stepsEarnedKcal(8000, 82)).toBe(205);
  });
});
