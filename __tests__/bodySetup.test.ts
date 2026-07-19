import { describe, expect, it } from '@jest/globals';

import {
  birthYearValid,
  bodyFatValid,
  goalWeightValid,
  heightValid,
  setupSteps,
  waistValid,
  weightValid,
} from '@/lib/core/insights/bodySetup';

const NOW = new Date('2026-07-09T12:00:00Z');

describe('setupSteps (the wizard sequence)', () => {
  it('maintain skips the destination and pace steps', () => {
    expect(setupSteps('maintain')).toEqual([
      'birthYear',
      'sex',
      'height',
      'weight',
      'bodyFat',
      'waist',
      'goal',
      'result',
    ]);
  });

  it('lose and gain add goal weight + tempo before the result', () => {
    for (const goal of ['lose', 'gain'] as const) {
      expect(setupSteps(goal)).toEqual([
        'birthYear',
        'sex',
        'height',
        'weight',
        'bodyFat',
        'waist',
        'goal',
        'goalWeight',
        'tempo',
        'result',
      ]);
    }
  });

  it('the waist step follows bodyFat (the device-free composition input)', () => {
    const steps = setupSteps('maintain');
    expect(steps.indexOf('waist')).toBe(steps.indexOf('bodyFat') + 1);
  });
});

describe('field validation (mirrors suggestPlan gates)', () => {
  it('birth year must give an age of 14–100', () => {
    expect(birthYearValid(1990, NOW)).toBe(true);
    expect(birthYearValid(2012, NOW)).toBe(true); // 14 — the engine’s own lower bound
    expect(birthYearValid(2020, NOW)).toBe(false); // age 6
    expect(birthYearValid(1920, NOW)).toBe(false); // age 106
    expect(birthYearValid(0, NOW)).toBe(false);
    expect(birthYearValid(NaN, NOW)).toBe(false);
  });

  it('height and weight follow the plausible adult bands', () => {
    expect(heightValid(175)).toBe(true);
    expect(heightValid(17)).toBe(false); // '17' typed on the way to '175'
    expect(heightValid(260)).toBe(false);
    expect(weightValid(80)).toBe(true);
    expect(weightValid(10)).toBe(false);
    expect(weightValid(500)).toBe(false);
  });

  it('body fat is optional: 0 = skipped is fine, a provided value needs the measured band', () => {
    expect(bodyFatValid(0)).toBe(true);
    expect(bodyFatValid(25)).toBe(true);
    expect(bodyFatValid(1)).toBe(false);
    expect(bodyFatValid(80)).toBe(false);
  });

  it('waist is optional: 0 = skipped is fine, a provided value needs the adult band', () => {
    expect(waistValid(0)).toBe(true);
    expect(waistValid(85)).toBe(true);
    expect(waistValid(39)).toBe(false);
    expect(waistValid(201)).toBe(false);
  });

  it('goal weight is optional but must point where the goal goes', () => {
    expect(goalWeightValid(0, 130, 'lose')).toBe(true); // skipped
    expect(goalWeightValid(90, 130, 'lose')).toBe(true);
    expect(goalWeightValid(150, 130, 'lose')).toBe(false); // «похудеть» to a heavier number
    expect(goalWeightValid(150, 130, 'gain')).toBe(true);
    expect(goalWeightValid(90, 130, 'gain')).toBe(false);
    expect(goalWeightValid(10, 130, 'lose')).toBe(false); // implausible
    expect(goalWeightValid(999, 130, 'maintain')).toBe(true); // maintain never reads it
  });
});
