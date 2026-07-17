import { describe, expect, it } from '@jest/globals';

import { WORKOUT_TYPES } from '@/lib/core/insights/bodyMetrics';
import {
  workoutTypeFromHcExerciseType,
  workoutTypeFromHkActivity,
} from '@/lib/core/services/exerciseTypeMap';

describe('workoutTypeFromHcExerciseType (Health Connect int codes)', () => {
  it('maps the everyday codes onto the app vocabulary', () => {
    expect(workoutTypeFromHcExerciseType(79)).toBe('walk'); // WALKING
    expect(workoutTypeFromHcExerciseType(56)).toBe('run'); // RUNNING
    expect(workoutTypeFromHcExerciseType(57)).toBe('run'); // RUNNING_TREADMILL
    expect(workoutTypeFromHcExerciseType(8)).toBe('cycle'); // BIKING
    expect(workoutTypeFromHcExerciseType(74)).toBe('swim'); // SWIMMING_POOL
    expect(workoutTypeFromHcExerciseType(70)).toBe('strength'); // STRENGTH_TRAINING
    expect(workoutTypeFromHcExerciseType(36)).toBe('hiit'); // HIIT
    expect(workoutTypeFromHcExerciseType(25)).toBe('elliptical'); // ELLIPTICAL
    expect(workoutTypeFromHcExerciseType(54)).toBe('row'); // ROWING_MACHINE
    expect(workoutTypeFromHcExerciseType(64)).toBe('sport'); // SOCCER
    expect(workoutTypeFromHcExerciseType(16)).toBe('dance'); // DANCING
    expect(workoutTypeFromHcExerciseType(11)).toBe('martial'); // BOXING
    expect(workoutTypeFromHcExerciseType(83)).toBe('yoga'); // YOGA
  });

  it("falls back to 'other' for unmapped codes (scuba, skiing, unknown)", () => {
    expect(workoutTypeFromHcExerciseType(59)).toBe('other'); // SCUBA_DIVING
    expect(workoutTypeFromHcExerciseType(61)).toBe('other'); // SKIING
    expect(workoutTypeFromHcExerciseType(0)).toBe('other'); // OTHER_WORKOUT
    expect(workoutTypeFromHcExerciseType(-1)).toBe('other');
    expect(workoutTypeFromHcExerciseType(9999)).toBe('other');
  });
});

describe('workoutTypeFromHkActivity (HealthKit names)', () => {
  it('maps the everyday activities onto the app vocabulary', () => {
    expect(workoutTypeFromHkActivity('Walking')).toBe('walk');
    expect(workoutTypeFromHkActivity('Running')).toBe('run');
    expect(workoutTypeFromHkActivity('Cycling')).toBe('cycle');
    expect(workoutTypeFromHkActivity('Swimming')).toBe('swim');
    expect(workoutTypeFromHkActivity('TraditionalStrengthTraining')).toBe('strength');
    expect(workoutTypeFromHkActivity('FunctionalStrengthTraining')).toBe('strength');
    expect(workoutTypeFromHkActivity('HighIntensityIntervalTraining')).toBe('hiit');
    expect(workoutTypeFromHkActivity('Elliptical')).toBe('elliptical');
    expect(workoutTypeFromHkActivity('Rowing')).toBe('row');
    expect(workoutTypeFromHkActivity('Soccer')).toBe('sport');
    expect(workoutTypeFromHkActivity('CardioDance')).toBe('dance');
    expect(workoutTypeFromHkActivity('MartialArts')).toBe('martial');
    expect(workoutTypeFromHkActivity('Yoga')).toBe('yoga');
  });

  it("is case-sensitive and falls back to 'other' for anything unknown", () => {
    expect(workoutTypeFromHkActivity('running')).toBe('other'); // HK names are PascalCase
    expect(workoutTypeFromHkActivity('SurfingSports')).toBe('other');
    expect(workoutTypeFromHkActivity('')).toBe('other');
  });

  it('never produces a type outside the app vocabulary', () => {
    const known = new Set<string>([...WORKOUT_TYPES, 'other']);
    for (const code of [0, 1, 8, 16, 25, 36, 54, 56, 59, 70, 74, 79, 83, 500]) {
      expect(known.has(workoutTypeFromHcExerciseType(code))).toBe(true);
    }
    for (const name of ['Walking', 'Yoga', 'Nonsense', 'Pickleball']) {
      expect(known.has(workoutTypeFromHkActivity(name))).toBe(true);
    }
  });
});
