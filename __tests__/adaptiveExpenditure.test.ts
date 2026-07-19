import { describe, expect, it } from '@jest/globals';

import {
  averageEarnedKcal,
  bmrFactorFromMeasured,
  BMR_FACTOR_MAX,
  BMR_FACTOR_MIN,
  measuredExpenditure,
  type IntakeDay,
} from '@/lib/core/insights/adaptiveExpenditure';

// Window ends here; the 14-day window is 2026-07-01 … 2026-07-14.
const NOW = new Date(2026, 6, 14, 12, 0, 0);

/// Intake for every day 07-01…07-14 at a flat kcal (full coverage).
function fullIntake(kcal: number): IntakeDay[] {
  return Array.from({ length: 14 }, (_, i) => ({
    date: `2026-07-${String(i + 1).padStart(2, '0')}`,
    kcal,
  }));
}

describe('measuredExpenditure (energy balance from weight trend + intake)', () => {
  it('flat weight → expenditure equals average intake', () => {
    const r = measuredExpenditure(
      fullIntake(2000),
      [
        { date: '2026-07-01', kg: 70 },
        { date: '2026-07-14', kg: 70 },
      ],
      NOW,
    )!;
    expect(r.kcalPerDay).toBe(2000);
    expect(r.weightSlopeKgPerWeek).toBe(0);
  });

  it('losing weight → expenditure is HIGHER than intake by the stored-energy deficit', () => {
    // 71.3 → 70.0 over 13 days = −0.1 kg/day → −770 kcal/day of stored energy.
    // expenditure = 2000 − (−770) = 2770.
    const r = measuredExpenditure(
      fullIntake(2000),
      [
        { date: '2026-07-01', kg: 71.3 },
        { date: '2026-07-14', kg: 70.0 },
      ],
      NOW,
    )!;
    expect(r.kcalPerDay).toBe(2770);
    expect(r.weightSlopeKgPerWeek).toBe(-0.7);
    expect(r.avgIntakeKcal).toBe(2000);
  });

  it('gaining weight → expenditure is LOWER than intake', () => {
    // +1.3 kg over 13 days → +0.1 kg/day → +770 kcal stored → burn 2000 − 770 = 1230.
    const r = measuredExpenditure(
      fullIntake(2000),
      [
        { date: '2026-07-01', kg: 70.0 },
        { date: '2026-07-14', kg: 71.3 },
      ],
      NOW,
    )!;
    expect(r.kcalPerDay).toBe(1230);
    expect(r.weightSlopeKgPerWeek).toBe(0.7);
  });

  it('a least-squares slope shrugs off a single water-weight spike', () => {
    const r = measuredExpenditure(
      fullIntake(2200),
      [
        { date: '2026-07-01', kg: 80.0 },
        { date: '2026-07-07', kg: 81.5 }, // transient spike (salt/water)
        { date: '2026-07-10', kg: 79.6 },
        { date: '2026-07-14', kg: 79.4 },
      ],
      NOW,
    )!;
    // Net trend is a mild loss, so expenditure sits modestly above intake — the
    // spike doesn't flip it into a "gaining" reading.
    expect(r.kcalPerDay).toBeGreaterThan(2200);
    expect(r.weightSlopeKgPerWeek).toBeLessThan(0);
    expect(r.confidence).toBe('good'); // 14 food days, 4 weigh-ins, 13-day span
  });

  it('confidence is «ok» with a start+end pair, «good» with denser data', () => {
    const twoPoints = measuredExpenditure(
      fullIntake(2000),
      [
        { date: '2026-07-01', kg: 70 },
        { date: '2026-07-14', kg: 70 },
      ],
      NOW,
    )!;
    expect(twoPoints.confidence).toBe('ok');
  });

  describe('honest gating — returns null rather than a shaky number', () => {
    const flatPair = [
      { date: '2026-07-01', kg: 70 },
      { date: '2026-07-14', kg: 70 },
    ];

    it('too few logged food days', () => {
      const sparse: IntakeDay[] = [
        { date: '2026-07-02', kcal: 2000 },
        { date: '2026-07-05', kcal: 2000 },
        { date: '2026-07-09', kcal: 2000 },
      ];
      expect(measuredExpenditure(sparse, flatPair, NOW)).toBeNull();
    });

    it('only one weigh-in (no trend possible)', () => {
      expect(measuredExpenditure(fullIntake(2000), [{ date: '2026-07-14', kg: 70 }], NOW)).toBeNull();
    });

    it('weigh-ins span less than a week (mostly water noise)', () => {
      const closePair = [
        { date: '2026-07-13', kg: 70.2 },
        { date: '2026-07-14', kg: 70.0 },
      ];
      expect(measuredExpenditure(fullIntake(2000), closePair, NOW)).toBeNull();
    });

    it('an absurd result (scale glitch) is clamped out, not surfaced', () => {
      // 10 kg "lost" in 13 days → ~5920 kcal/day of phantom deficit → >6000 burn.
      const glitch = [
        { date: '2026-07-01', kg: 80 },
        { date: '2026-07-14', kg: 70 },
      ];
      expect(measuredExpenditure(fullIntake(2000), glitch, NOW)).toBeNull();
    });

    it('ignores data outside the trailing window', () => {
      const old: IntakeDay[] = Array.from({ length: 14 }, (_, i) => ({
        date: `2026-06-${String(i + 1).padStart(2, '0')}`,
        kcal: 2000,
      }));
      expect(
        measuredExpenditure(old, [
          { date: '2026-06-01', kg: 70 },
          { date: '2026-06-14', kg: 70 },
        ], NOW),
      ).toBeNull();
    });
  });
});

describe('averageEarnedKcal (per-day steps + workout eat-back)', () => {
  it('averages the same «шаги +N» + 75% workout eat-back the budget credits', () => {
    // 100 kg, 8000 steps → (8000−3000)·0.0005·100 = 250; 3000 steps → 0. Avg 125.
    expect(averageEarnedKcal([{ steps: 8000, workoutSteps: 0, workoutKcal: 0 }, { steps: 3000, workoutSteps: 0, workoutKcal: 0 }], 100)).toBe(125);
    // A pure workout day: 0 step-earned + round(400·0.75) = 300.
    expect(averageEarnedKcal([{ steps: 3000, workoutSteps: 0, workoutKcal: 400 }], 100)).toBe(300);
  });

  it('subtracts workout-window steps so a watch run is not double-counted', () => {
    // 8000 steps but 5000 of them inside a workout → priced on 3000 → 0 earned.
    expect(averageEarnedKcal([{ steps: 8000, workoutSteps: 5000, workoutKcal: 0 }], 100)).toBe(0);
  });

  it('empty list → 0 (a no-movement-data user folds all TDEE into resting)', () => {
    expect(averageEarnedKcal([], 100)).toBe(0);
  });
});

describe('bmrFactorFromMeasured (measured TDEE → BMR calibration factor)', () => {
  it('backs out the resting BMR and forms a factor over the formula BMR', () => {
    // resting = 2800 − 300 = 2500; implied BMR = 2500/1.2 = 2083.3; /2000 = 1.042.
    expect(bmrFactorFromMeasured(2800, 300, 2000)).toBeCloseTo(1.042, 3);
  });

  it('clamps a runaway ratio into the safe band', () => {
    expect(bmrFactorFromMeasured(5000, 0, 2000)).toBe(BMR_FACTOR_MAX);
    expect(bmrFactorFromMeasured(1000, 0, 2500)).toBe(BMR_FACTOR_MIN);
  });

  it('null when the formula BMR is unusable', () => {
    expect(bmrFactorFromMeasured(2800, 300, 0)).toBeNull();
  });
});
