import { describe, expect, it } from '@jest/globals';

import { mealTitle, shortMealTitle } from '@/lib/core/insights/mealTitle';
import type { NutritionItem, Per100 } from '@/lib/core/services/foodParser';

function per100(kcal: number): Per100 {
  return { kcal, prot: 10, fat: 1, carb: 2, minerals: {}, source: 'skurikhin' };
}

function item(over: Partial<NutritionItem> = {}): NutritionItem {
  return {
    name_ru: 'борщ',
    name_en: 'borscht',
    grams: 300,
    grams_source: 'estimated',
    confidence: 0.8,
    per100: per100(50),
    scaled: { kcal: 150, prot: 5, fat: 2, carb: 10, minerals: {} },
    approximate: true,
    ...over,
  };
}

describe('mealTitle', () => {
  it('names the meal by its dishes instead of the sentence that was said', () => {
    const title = mealTitle(
      [item(), item({ name_ru: 'хлеб', name_en: 'bread' }), item({ name_ru: 'сметана', name_en: 'sour cream' })],
      'RU',
    );
    expect(title).toBe('Борщ, хлеб, сметана');
  });

  it('keeps every dish, because this string is also what gets re-parsed', () => {
    const names = ['борщ', 'хлеб', 'сметана', 'кофе', 'сахар'];
    const title = mealTitle(
      names.map((n) => item({ name_ru: n, name_en: n })),
      'RU',
    );
    // Dropping the tail here would delete two dishes on the next re-parse.
    expect(title).toBe('Борщ, хлеб, сметана, кофе, сахар');
  });

  it('collapses a dish parsed as two rows into one word', () => {
    const title = mealTitle([item({ name_ru: 'хлеб' }), item({ name_ru: 'Хлеб' })], 'RU');
    expect(title).toBe('Хлеб');
  });

  it('uses the row the user explicitly picked, not their raw wording', () => {
    const title = mealTitle(
      [item({ name_ru: 'скир', matched_name: 'Скир натуральный', userChosen: true })],
      'RU',
    );
    expect(title).toBe('Скир натуральный');
  });

  it('follows the region for naming', () => {
    expect(mealTitle([item()], 'US')).toBe('Borscht');
  });

  it('returns nothing for an empty meal so the caller can decide the fallback', () => {
    expect(mealTitle([], 'RU')).toBe('');
    // A blank name must not become a title made of a comma.
    expect(mealTitle([item({ name_ru: '  ', name_en: '' })], 'RU')).toBe('');
  });
});

describe('shortMealTitle', () => {
  it('cuts on a dish boundary, not mid-word', () => {
    expect(shortMealTitle('Борщ, хлеб, сметана, кофе, сахар')).toBe('Борщ, хлеб, сметана +2');
  });

  it('leaves a title that already fits alone', () => {
    expect(shortMealTitle('Борщ, хлеб, сметана')).toBe('Борщ, хлеб, сметана');
    expect(shortMealTitle('Борщ')).toBe('Борщ');
  });

  it('does not chop a free-typed sentence into fake dishes', () => {
    // Old entries (and manual renames) are prose, not lists. Inventing breaks in
    // them would read as garbage; let the row ellipsize instead.
    const prose = 'я на завтрак съел борщ с хлебом и запил его кофе';
    expect(shortMealTitle(prose)).toBe(prose);
  });

  it('ignores empty segments from sloppy commas', () => {
    expect(shortMealTitle('Борщ, , хлеб, сметана, кофе,')).toBe('Борщ, хлеб, сметана +1');
  });
});
