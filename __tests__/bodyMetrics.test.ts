import { describe, expect, it } from '@jest/globals';

import {
  ACTIVITY_FACTORS,
  bmiCategory,
  bmiValue,
  mifflinBmr,
  suggestPlan,
  suggestTargets,
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
    expect(suggestTargets({ ...profile, birthYear: 0 }, 70, NOW)).toBeNull();
    expect(suggestTargets({ ...profile, birthYear: 2020 }, 70, NOW)).toBeNull(); // age 6
    expect(suggestTargets({ ...profile, heightCm: 0 }, 70, NOW)).toBeNull();
    expect(suggestTargets(profile, 0, NOW)).toBeNull(); // no weight logged yet
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
});
