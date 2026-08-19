import { describe, expect, it } from '@jest/globals';

import { contributableFoods } from '@/lib/core/services/communityShare';
import type { MealDraft, NutritionItem, NutritionSource, Per100, Region } from '@/lib/core/services/foodParser';
import { recomputeDraft } from '@/lib/core/services/mealDraft';

/**
 * WHAT MAY LEAVE THE PHONE FOR THE SHARED BASE.
 *
 * The base is public and permanent-ish, so the interesting assertions here are
 * the refusals: a guess must not become everyone's truth, a table's row must not
 * be shadowed by a crowd copy of itself, a community row must not vote for
 * itself, and a sentence someone typed about their evening must not become a
 * searchable entry under their words.
 */

function per100(source: NutritionSource, kcal = 215): Per100 {
  return { source, kcal, prot: 12, fat: 11, carb: 16, minerals: {} };
}

function item(name: string, source: NutritionSource, extra: Partial<NutritionItem> = {}): NutritionItem {
  const p = per100(source);
  return {
    name_ru: name,
    name_en: name,
    grams: 200,
    grams_source: 'confirmed',
    confidence: 1,
    per100: p,
    scaled: { kcal: p.kcal * 2, prot: 24, fat: 22, carb: 32, minerals: {} },
    approximate: false,
    ...extra,
  };
}

function draftOf(items: NutritionItem[], region: Region = 'RU'): MealDraft {
  return recomputeDraft(region, items);
}

describe('what a saved meal may offer the shared base', () => {
  it('offers a dish whose numbers the user typed themselves', () => {
    const out = contributableFoods(draftOf([item('Шаурма с курицей', 'manual')]), 'RU');
    expect(out).toEqual([{ name: 'Шаурма с курицей', per100: per100('manual') }]);
  });

  it('offers numbers read off the package in a photo', () => {
    const out = contributableFoods(draftOf([item('Сырок Александров', 'label')]), 'RU');
    expect(out.map((f) => f.name)).toEqual(['Сырок Александров']);
  });

  it('never offers the model’s guess', () => {
    // The app's standing rule is that an AI estimate is not «моя правда» until
    // the user touches it. Making it EVERYONE's truth is that mistake, scaled.
    expect(contributableFoods(draftOf([item('Шаурма', 'ai_estimate')]), 'RU')).toEqual([]);
  });

  it('never offers a database miss — there are no numbers in it to offer', () => {
    expect(contributableFoods(draftOf([item('Шаурма', 'estimate')]), 'RU')).toEqual([]);
  });

  it('never offers a row a composition table already owns', () => {
    for (const source of ['usda', 'skurikhin', 'openfoodfacts', 'fatsecret', 'apininjas'] as const) {
      expect(contributableFoods(draftOf([item('Борщ', source)]), 'RU')).toEqual([]);
    }
  });

  it('never lets a community row vote for itself', () => {
    // Otherwise one entry inflates its own confirmation count on every meal it
    // is logged into, and «записей: 40» would mean one person, forty lunches.
    expect(contributableFoods(draftOf([item('Шаурма', 'community')]), 'RU')).toEqual([]);
  });

  it('never offers a re-log from the user’s own journal', () => {
    expect(contributableFoods(draftOf([item('Шаурма', 'history')]), 'RU')).toEqual([]);
  });
});

describe('what a name has to look like to be published', () => {
  it('refuses a sentence — the shape a private detail actually arrives in', () => {
    const out = contributableFoods(
      draftOf([item('то что дала бабушка Люда вчера', 'manual')]),
      'RU',
    );
    expect(out).toEqual([]);
  });

  it('refuses a quantity or an empty label', () => {
    expect(contributableFoods(draftOf([item('250', 'manual')]), 'RU')).toEqual([]);
    expect(contributableFoods(draftOf([item('   ', 'manual')]), 'RU')).toEqual([]);
  });

  it('refuses a name longer than the base accepts', () => {
    expect(contributableFoods(draftOf([item('ш'.repeat(61), 'manual')]), 'RU')).toEqual([]);
  });
});

describe('the shape of what is offered', () => {
  it('offers foods, never the meal — no weight, no time, no entry text', () => {
    const [food] = contributableFoods(draftOf([item('Плов домашний', 'manual')]), 'RU');
    expect(Object.keys(food ?? {}).sort()).toEqual(['name', 'per100']);
  });

  it('counts one dish once even when the plate holds it twice', () => {
    const out = contributableFoods(
      draftOf([item('Сырники', 'manual'), item('сырники', 'manual')]),
      'RU',
    );
    expect(out).toHaveLength(1);
  });

  it('publishes the DB row the user explicitly picked, not their raw typing', () => {
    // `displayItemName`'s rule: once the user chose a match, the entry is named
    // by the row they chose. The base should learn that name, not «скир».
    const out = contributableFoods(
      draftOf([item('скир', 'manual', { userChosen: true, matched_name: 'Скир натуральный' })]),
      'RU',
    );
    expect(out.map((f) => f.name)).toEqual(['Скир натуральный']);
  });

  it('follows the region for the name it publishes', () => {
    const ru = item('Гречка', 'manual');
    const bilingual: NutritionItem = { ...ru, name_ru: 'Гречка', name_en: 'Buckwheat' };
    expect(contributableFoods(draftOf([bilingual], 'US'), 'US').map((f) => f.name)).toEqual(['Buckwheat']);
    expect(contributableFoods(draftOf([bilingual], 'RU'), 'RU').map((f) => f.name)).toEqual(['Гречка']);
  });

  it('offers nothing for a meal with nothing worth sharing', () => {
    expect(contributableFoods(draftOf([]), 'RU')).toEqual([]);
  });
});
