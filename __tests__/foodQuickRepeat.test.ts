import { describe, expect, it } from '@jest/globals';

import { deriveDayMeals, deriveQuickMeals } from '@/lib/core/db/food';

/** A4 — one-tap re-logging. Pure ranking over past entries (no schema). */

const mk = (rawText: string, ts: Date, kcal = 100, proteinG = 10) => ({
  rawText,
  ts,
  kcal,
  proteinG,
  fatG: 1,
  carbG: 2,
});

// Three days of history (June 2026). June 23 has a same-day repeat of «Овсянка».
const entries = [
  mk('Кофе', new Date(2026, 5, 24, 9, 0)), // today
  mk('Овсянка', new Date(2026, 5, 23, 8, 0)), // yesterday, 1st
  mk('Курица', new Date(2026, 5, 23, 13, 0)), // yesterday
  mk('Овсянка', new Date(2026, 5, 23, 20, 0)), // yesterday, repeat (latest)
  mk('Суп', new Date(2026, 5, 22, 12, 0)), // two days ago
];

describe('deriveDayMeals (same as yesterday)', () => {
  it('returns only the target day, distinct, newest first', () => {
    const day = deriveDayMeals(entries, new Date(2026, 5, 23, 10, 0));
    expect(day.map((m) => m.rawText)).toEqual(['Овсянка', 'Курица']);
    expect(day[0].count).toBe(2); // same-day repeat collapsed
  });

  it('handles a single-entry day and an empty day', () => {
    expect(deriveDayMeals(entries, new Date(2026, 5, 22)).map((m) => m.rawText)).toEqual(['Суп']);
    expect(deriveDayMeals(entries, new Date(2026, 5, 25))).toEqual([]);
  });

  it('is order-independent (input row order does not change output)', () => {
    const shuffled = [...entries].reverse();
    expect(deriveDayMeals(shuffled, new Date(2026, 5, 23)).map((m) => m.rawText)).toEqual([
      'Овсянка',
      'Курица',
    ]);
  });
});

describe('deriveQuickMeals after the shared-grouping refactor', () => {
  it('favorites = repeated meals (count ≥ 2) by frequency', () => {
    const { favorites } = deriveQuickMeals(entries);
    expect(favorites.map((m) => m.rawText)).toEqual(['Овсянка']);
    expect(favorites[0].count).toBe(2);
  });

  it('recents = distinct meals newest-first', () => {
    const { recents } = deriveQuickMeals(entries);
    expect(recents.map((m) => m.rawText)).toEqual(['Кофе', 'Овсянка', 'Курица', 'Суп']);
  });
});
