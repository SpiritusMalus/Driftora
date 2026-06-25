import { describe, expect, it } from '@jest/globals';

import { mealPromptKeyForHour } from '@/lib/core/insights/mealPrompt';

describe('mealPromptKeyForHour (A3)', () => {
  it('maps each window at its boundaries', () => {
    expect(mealPromptKeyForHour(5)).toBe('morning');
    expect(mealPromptKeyForHour(10)).toBe('morning');
    expect(mealPromptKeyForHour(11)).toBe('midday');
    expect(mealPromptKeyForHour(15)).toBe('midday');
    expect(mealPromptKeyForHour(16)).toBe('evening');
    expect(mealPromptKeyForHour(21)).toBe('evening');
    expect(mealPromptKeyForHour(22)).toBe('lateNight');
    expect(mealPromptKeyForHour(4)).toBe('lateNight');
    expect(mealPromptKeyForHour(0)).toBe('lateNight');
  });

  it('normalizes out-of-range / fractional hours instead of throwing', () => {
    expect(mealPromptKeyForHour(9.7)).toBe('morning'); // trunc → 9
    expect(mealPromptKeyForHour(24)).toBe('lateNight'); // → 0
    expect(mealPromptKeyForHour(-1)).toBe('lateNight'); // → 23
    expect(mealPromptKeyForHour(30)).toBe('morning'); // → 6
  });

  it('covers all 24 hours with a valid key', () => {
    const keys = new Set(['morning', 'midday', 'evening', 'lateNight']);
    for (let h = 0; h < 24; h++) expect(keys.has(mealPromptKeyForHour(h))).toBe(true);
  });
});
