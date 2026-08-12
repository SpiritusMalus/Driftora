import { describe, expect, it } from '@jest/globals';

import type { NutritionItem, Per100 } from '@/lib/core/services/foodParser';
import { mergeReparsedItems } from '@/lib/core/services/reparseMerge';

function per100(kcal: number, source: Per100['source'] = 'skurikhin'): Per100 {
  return { kcal, prot: 10, fat: 1, carb: 2, minerals: {}, source };
}

function item(over: Partial<NutritionItem> = {}): NutritionItem {
  return {
    name_ru: 'борщ',
    name_en: 'borscht',
    grams: 300,
    grams_source: 'estimated',
    confidence: 0.8,
    per100: per100(50),
    scaled: { kcal: 150, prot: 30, fat: 3, carb: 6, minerals: {} },
    approximate: true,
    ...over,
  };
}

describe('mergeReparsedItems', () => {
  it('keeps a weight the user typed when the dish survives the re-parse', () => {
    const previous = [item({ grams: 450, grams_source: 'confirmed' })];
    // The user added coffee to the text; the model re-guesses borscht at 300 g.
    const next = [item({ grams: 300 }), item({ name_ru: 'кофе', name_en: 'coffee' })];

    const merged = mergeReparsedItems(previous, next, 'RU');

    expect(merged[0]!.grams).toBe(450);
    expect(merged[0]!.grams_source).toBe('confirmed');
    // …and the portion follows that weight, not the stale numbers.
    expect(merged[0]!.scaled.kcal).toBe(225); // 450 g at 50 kcal/100 g
    expect(merged[1]!.name_ru).toBe('кофе');
  });

  it('rescales a carried weight against the FRESH per-100g', () => {
    const previous = [item({ grams: 200, grams_source: 'confirmed', per100: per100(50) })];
    // The re-parse matched a different row — 200 kcal/100 g this time.
    const next = [item({ per100: per100(200) })];

    const merged = mergeReparsedItems(previous, next, 'RU');

    expect(merged[0]!.per100.kcal).toBe(200);
    // Pairing the old scaled numbers with the new per-100g would invent a
    // portion matching neither.
    expect(merged[0]!.scaled.kcal).toBe(400);
  });

  it('does not overwrite a guessed weight — a fresh guess is not an edit worth keeping', () => {
    const previous = [item({ grams: 999 })]; // still 'estimated'
    const next = [item({ grams: 300 })];

    expect(mergeReparsedItems(previous, next, 'RU')[0]!.grams).toBe(300);
  });

  it('keeps a match the user picked themselves, including its per-100g', () => {
    const previous = [
      item({ name_ru: 'скир', matched_name: 'Скир натуральный', userChosen: true, per100: per100(63, 'fatsecret') }),
    ];
    const next = [item({ name_ru: 'скир', per100: per100(120) })];

    const merged = mergeReparsedItems(previous, next, 'RU');

    expect(merged[0]!.userChosen).toBe(true);
    expect(merged[0]!.matched_name).toBe('Скир натуральный');
    expect(merged[0]!.per100.kcal).toBe(63);
  });

  it('drops dishes the user removed from the text', () => {
    const previous = [item(), item({ name_ru: 'хлеб', name_en: 'bread', grams_source: 'confirmed', grams: 80 })];
    const next = [item()];

    const merged = mergeReparsedItems(previous, next, 'RU');

    expect(merged).toHaveLength(1);
    expect(merged[0]!.name_ru).toBe('борщ');
  });

  it('matches by name, not position, so a dish added mid-sentence shifts nothing', () => {
    const previous = [item({ name_ru: 'хлеб', name_en: 'bread', grams: 80, grams_source: 'confirmed' }), item()];
    // Coffee lands first in the fresh parse; bread has moved to the end.
    const next = [item({ name_ru: 'кофе', name_en: 'coffee' }), item(), item({ name_ru: 'хлеб', name_en: 'bread' })];

    const merged = mergeReparsedItems(previous, next, 'RU');

    expect(merged[2]!.name_ru).toBe('хлеб');
    expect(merged[2]!.grams).toBe(80);
    expect(merged[0]!.name_ru).toBe('кофе');
  });

  it('reuses one previous row per name rather than guessing between duplicates', () => {
    const previous = [
      item({ name_ru: 'хлеб', name_en: 'bread', grams: 80, grams_source: 'confirmed' }),
      item({ name_ru: 'хлеб', name_en: 'bread', grams: 200, grams_source: 'confirmed' }),
    ];
    const next = [item({ name_ru: 'хлеб', name_en: 'bread' })];

    expect(mergeReparsedItems(previous, next, 'RU')[0]!.grams).toBe(80);
  });
});
