import assert from 'node:assert/strict';
import { test } from 'node:test';

import { kcalBandViolated } from '../src/nutrition/plausibility.js';
import type { NutritionProvider } from '../src/nutrition/provider.js';
import { Resolver } from '../src/nutrition/resolver.js';
import { coercePer100 } from '../src/types.js';

// ---- the band table itself --------------------------------------------------

test('bands: the observed failure — a vegetable at 306 kcal — is caught', () => {
  assert.equal(kcalBandViolated('кабачки', 'zucchini', 306), true);
  assert.equal(kcalBandViolated('кабачки тушеные', 'stewed zucchini', 16), false);
});

test('bands: legitimate preparations never fire (no false positives)', () => {
  assert.equal(kcalBandViolated('борщ', 'borscht', 49), false);
  assert.equal(kcalBandViolated('солянка', 'solyanka soup', 90), false);
  assert.equal(kcalBandViolated('темный шоколад с начинкой', 'filled dark chocolate', 490), false);
  assert.equal(kcalBandViolated('сливочное масло', 'butter', 748), false);
  assert.equal(kcalBandViolated('молоко 3.2%', 'whole milk', 60), false);
  assert.equal(kcalBandViolated('банан', 'banana', 96), false);
});

test('bands: ambiguous or excluded words stay unjudged', () => {
  // Potatoes fry up to ~300, «салат» is usually the dish, avocado is a fat bomb,
  // сало would poison any meat band — none of them may ever be flagged.
  assert.equal(kcalBandViolated('картофель жареный', 'fried potatoes', 290), false);
  assert.equal(kcalBandViolated('салат с фасолью и морковью', 'bean salad', 238), false);
  assert.equal(kcalBandViolated('авокадо', 'avocado', 160), false);
  assert.equal(kcalBandViolated('свиное сало', 'salo pork fat', 800), false);
});

test('bands: dried forms leave their fresh band', () => {
  // The #163 lesson in reverse: dried tarragon at 295 is REAL — a fresh-herb
  // band must not "correct" a legitimately dried product.
  assert.equal(kcalBandViolated('вишня сушеная', 'dried cherries', 290), false);
});

test('bands: a chocolate product at generic-junk 329 is flagged low', () => {
  assert.equal(kcalBandViolated('шоколадный батончик', 'chocolate bar', 329), true);
});

// ---- end-to-end through the resolver ---------------------------------------

function provider(kcal: number, confidence: number, name: string): NutritionProvider {
  return {
    name: 'usda',
    regions: ['RU', 'US'],
    queryLang: 'en',
    async search() {
      return { name, per100: coercePer100({ source: 'usda', kcal, prot: 5, fat: 13, carb: 42 }), confidence };
    },
  };
}

test('resolve: a confident band-violating row loses to the on-demand estimate', async () => {
  let asked = 0;
  const resolver = new Resolver([provider(306, 0.9, 'squash breaded fried')], async () => {
    asked += 1;
    return { name: 'кабачки', kcal: 20, prot: 1.2, fat: 0.2, carb: 3.4 };
  });

  const r = await resolver.resolveItem(
    { name_ru: 'кабачки', name_en: 'squash', est_grams: 40, confidence: 0.9 },
    'RU',
  );

  assert.equal(asked, 1, 'the band violation triggers the estimator fetch');
  assert.equal(r.per100.source, 'ai_estimate', 'estimate is primary over the absurd row');
  assert.equal(r.per100.kcal, 20);
  assert.ok(
    r.alternatives?.some((a) => a.per100.kcal === 306),
    'the DB row survives as a one-tap alternative — never silently erased',
  );
});

test('resolve: an in-band row costs no estimator call at all', async () => {
  let asked = 0;
  const resolver = new Resolver([provider(18, 0.95, 'cherry tomatoes')], async () => {
    asked += 1;
    return { name: 'x', kcal: 1, prot: 1, fat: 1, carb: 1 };
  });

  const r = await resolver.resolveItem(
    { name_ru: 'помидоры черри', name_en: 'cherry tomatoes', est_grams: 100, confidence: 0.9 },
    'RU',
  );

  assert.equal(asked, 0, 'the zero-latency referee is genuinely zero-latency');
  assert.equal(r.per100.kcal, 18);
});
