import { describe, expect, it } from '@jest/globals';

import { groupEntriesByMeal, mealTypeForEntry, mealTypeFromKeyword } from '@/lib/core/insights/mealType';

/** A Date at a fixed local hour (minute 0), for the time-of-day fallback. */
function at(hour: number): Date {
  const d = new Date(2026, 5, 30, hour, 0, 0);
  return d;
}

describe('mealTypeFromKeyword', () => {
  it('detects each meal by its Russian keyword', () => {
    expect(mealTypeFromKeyword('завтрак: омлет')).toBe('breakfast');
    expect(mealTypeFromKeyword('пообедал борщом')).toBe('lunch');
    expect(mealTypeFromKeyword('ужин — курица с рисом')).toBe('dinner');
    expect(mealTypeFromKeyword('полдник: яблоко')).toBe('snack');
    expect(mealTypeFromKeyword('лёгкий перекус')).toBe('snack');
  });

  it('detects English keywords and folds ё', () => {
    expect(mealTypeFromKeyword('Breakfast burrito')).toBe('breakfast');
    expect(mealTypeFromKeyword('late dinner')).toBe('dinner');
    expect(mealTypeFromKeyword('ПЕРЕКУС')).toBe('snack');
  });

  it('returns null when no meal word is present', () => {
    expect(mealTypeFromKeyword('омлет и кофе')).toBeNull();
    expect(mealTypeFromKeyword('')).toBeNull();
  });
});

describe('mealTypeForEntry — keyword wins over time, else falls back to hour', () => {
  it('honors an explicit keyword even at an odd hour', () => {
    // 23:00 would map to a late-night snack, but the user said «завтрак».
    expect(mealTypeForEntry('завтрак после смены', at(23))).toBe('breakfast');
  });

  it('falls back to the clock when no keyword is given', () => {
    expect(mealTypeForEntry('омлет', at(8))).toBe('breakfast');
    expect(mealTypeForEntry('борщ', at(13))).toBe('lunch');
    expect(mealTypeForEntry('курица', at(19))).toBe('dinner');
    expect(mealTypeForEntry('яблоко', at(2))).toBe('snack');
  });
});

describe('groupEntriesByMeal', () => {
  it('buckets entries into meals ordered chronologically, dropping empty meals', () => {
    const entries = [
      { id: 1, rawText: 'курица', ts: at(19) }, // dinner (by hour)
      { id: 2, rawText: 'завтрак: омлет', ts: at(9) }, // breakfast (keyword)
      { id: 3, rawText: 'перекус', ts: at(16) }, // snack (keyword)
      { id: 4, rawText: 'обед', ts: at(13) }, // lunch (keyword)
    ];
    const groups = groupEntriesByMeal(entries);
    expect(groups.map((g) => g.type)).toEqual(['breakfast', 'lunch', 'snack', 'dinner']);
    expect(groups.map((g) => g.entries.map((e) => e.id))).toEqual([[2], [4], [3], [1]]);
  });

  it('preserves input order within a meal (newest-first stays newest-first)', () => {
    const entries = [
      { id: 10, rawText: 'омлет', ts: at(9) },
      { id: 11, rawText: 'кофе', ts: at(8) },
    ];
    const groups = groupEntriesByMeal(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe('breakfast');
    expect(groups[0].entries.map((e) => e.id)).toEqual([10, 11]);
  });

  it('a stored user-picked meal beats both the clock and a keyword', () => {
    const entries = [
      // 11:41 would be «обед» by the clock — the user filed it as завтрак
      // (the exact device complaint this feature answers).
      { id: 1, rawText: 'адреналин раш', ts: new Date(2026, 5, 30, 11, 41), meal: 'breakfast' as const },
      // Even a typed «обед…» loses to an explicit later re-file.
      { id: 2, rawText: 'обед: борщ', ts: at(13), meal: 'dinner' as const },
    ];
    const groups = groupEntriesByMeal(entries);
    expect(groups.map((g) => g.type)).toEqual(['breakfast', 'dinner']);
    expect(groups[0].entries.map((e) => e.id)).toEqual([1]);
    expect(groups[1].entries.map((e) => e.id)).toEqual([2]);
  });

  it('entries without a stored meal (old rows, repeats) keep the heuristic', () => {
    const entries = [
      { id: 1, rawText: 'борщ', ts: at(13), meal: null },
      { id: 2, rawText: 'борщ', ts: at(13) },
    ];
    const groups = groupEntriesByMeal(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe('lunch');
    expect(groups[0].entries.map((e) => e.id)).toEqual([1, 2]);
  });
});
