import { describe, expect, it } from '@jest/globals';

import {
  expectedStepFractionByHour,
  planNudges,
  type NudgeContext,
} from '@/lib/core/insights/nudgeRules';

/// A baseline behind-pace afternoon context (13:00, well short of a 7,000 goal).
const behindAfternoon: NudgeContext = { hour: 13, steps: 800, stepsGoal: 7000 };

describe('expectedStepFractionByHour', () => {
  it('is 0 before the active day and 1 after it', () => {
    expect(expectedStepFractionByHour(6)).toBe(0);
    expect(expectedStepFractionByHour(7)).toBe(0);
    expect(expectedStepFractionByHour(22)).toBe(1);
    expect(expectedStepFractionByHour(23)).toBe(1);
  });

  it('rises monotonically through the day', () => {
    expect(expectedStepFractionByHour(10)).toBeLessThan(expectedStepFractionByHour(15));
    expect(expectedStepFractionByHour(15)).toBeLessThan(expectedStepFractionByHour(20));
  });
});

describe('planNudges', () => {
  it('returns nothing when paused (a break mutes every nudge)', () => {
    expect(planNudges({ ...behindAfternoon, paused: true })).toEqual([]);
  });

  it('suggests an afternoon walk when behind pace in the early afternoon', () => {
    expect(planNudges(behindAfternoon)).toEqual([
      { type: 'afternoon_walk', hour: 15, minute: 30 },
    ]);
  });

  it('does NOT fire in the morning, when low steps are normal', () => {
    // 09:00 with the same low count — the afternoon window has not opened yet.
    expect(planNudges({ hour: 9, steps: 800, stepsGoal: 7000 })).toEqual([]);
  });

  it('does not nudge when steps are on pace', () => {
    expect(planNudges({ hour: 13, steps: 5000, stepsGoal: 7000 })).toEqual([]);
  });

  it('suggests an evening walk when still well short of the goal at dusk', () => {
    expect(planNudges({ hour: 18, steps: 3000, stepsGoal: 7000 })).toEqual([
      { type: 'evening_walk', hour: 19, minute: 30 },
    ]);
  });

  it('a low mood logged today + low movement wins the slot (priority + cap)', () => {
    // Both mood_walk and afternoon_walk qualify; the default cap of 1 keeps the
    // higher-priority mood nudge only.
    expect(planNudges({ hour: 13, steps: 500, stepsGoal: 7000, mood: 2 })).toEqual([
      { type: 'mood_walk', hour: 14, minute: 0 },
    ]);
  });

  it('respects a higher per-day cap, in priority order', () => {
    expect(
      planNudges({ hour: 13, steps: 500, stepsGoal: 7000, mood: 2 }, { maxPerDay: 2 }),
    ).toEqual([
      { type: 'mood_walk', hour: 14, minute: 0 },
      { type: 'afternoon_walk', hour: 15, minute: 30 },
    ]);
  });

  it('ignores mood when none was logged today (null)', () => {
    expect(planNudges({ ...behindAfternoon, mood: null })).toEqual([
      { type: 'afternoon_walk', hour: 15, minute: 30 },
    ]);
  });

  it('does not nudge a good mood', () => {
    expect(planNudges({ hour: 11, steps: 500, stepsGoal: 7000, mood: 8 })).toEqual([]);
  });

  it('produces nothing without a step goal (no pace reference)', () => {
    expect(planNudges({ hour: 13, steps: 0, stepsGoal: 0, mood: 1 })).toEqual([]);
  });

  it('caps to zero when asked', () => {
    expect(planNudges(behindAfternoon, { maxPerDay: 0 })).toEqual([]);
  });
});
