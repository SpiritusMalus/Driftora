import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { OpenFoodFactsProvider } from '../src/nutrition/openfoodfacts.js';
import { Resolver } from '../src/nutrition/resolver.js';
import { UsdaProvider } from '../src/nutrition/usda.js';
import type { IdentifiedItem } from '../src/types.js';

const realFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A USDA `foods/search` payload for chicken breast, per-100g (with minerals). */
const usdaChicken = {
  foods: [
    {
      description: 'Chicken, breast, raw',
      score: 100,
      foodNutrients: [
        { nutrientNumber: '1008', value: 165 }, // kcal
        { nutrientNumber: '1003', value: 31 }, // protein
        { nutrientNumber: '1004', value: 3.6 }, // fat
        { nutrientNumber: '1005', value: 0 }, // carbs
        { nutrientNumber: '1093', value: 74 }, // sodium
        { nutrientNumber: '1092', value: 256 }, // potassium
        { nutrientNumber: '1089', value: 1 }, // iron
      ],
    },
  ],
};

let calls: string[] = [];

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(handler: (url: string) => Response): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
}

function item(over: Partial<IdentifiedItem> = {}): IdentifiedItem {
  return { name_ru: 'куриная грудка', name_en: 'chicken breast', est_grams: 150, confidence: 0.9, ...over };
}

test('USDA mapping incl. minerals, then per100 → scaled math', async () => {
  mockFetch(() => json(usdaChicken));
  const resolver = new Resolver([new UsdaProvider('KEY'), new OpenFoodFactsProvider()]);

  const r = await resolver.resolveItem(item(), 'US');
  assert.equal(r.per100.source, 'usda');
  assert.equal(r.per100.kcal, 165);
  assert.equal(r.per100.prot, 31);
  assert.deepEqual(r.per100.minerals, { na: 74, k: 256, fe: 1 });

  // scaled = per100 * 150 / 100
  assert.equal(r.scaled.kcal, 248);
  assert.equal(r.scaled.prot, 46.5);
  assert.deepEqual(r.scaled.minerals, { na: 111, k: 384, fe: 2 });
  assert.equal(r.approximate, true);
  assert.equal(r.grams_source, 'estimated');
});

test('region routing: USDA is skipped for RU (US-only provider)', async () => {
  mockFetch(() => json(usdaChicken));
  // USDA + OFF; for RU neither resolves a plain name → estimate, and USDA is
  // never queried because it does not serve RU.
  const resolver = new Resolver([new UsdaProvider('KEY'), new OpenFoodFactsProvider()]);

  const r = await resolver.resolveItem(item(), 'RU');
  assert.equal(r.per100.source, 'estimate');
  assert.equal(calls.length, 0, 'no provider in the RU chain should hit the network here');
});

test('DB miss → coarse estimate, flagged not-fact', async () => {
  mockFetch(() => json({ foods: [] }));
  const resolver = new Resolver([new UsdaProvider('KEY')]);

  const r = await resolver.resolveItem(item({ name_en: 'unobtanium souffle' }), 'US');
  assert.equal(r.per100.source, 'estimate');
  assert.equal(r.per100.kcal, 150);
});

test('LRU cache: identical (name, region) hits the network once', async () => {
  mockFetch(() => json(usdaChicken));
  const resolver = new Resolver([new UsdaProvider('KEY')]);

  await resolver.resolveItem(item(), 'US');
  await resolver.resolveItem(item({ est_grams: 200 }), 'US');
  assert.equal(calls.length, 1, 'second identical lookup should be served from cache');
});

test('OpenFoodFacts resolves a barcode and converts mineral grams → mg', async () => {
  mockFetch(() =>
    json({
      status: 1,
      product: {
        nutriments: {
          'energy-kcal_100g': 539,
          proteins_100g: 6.3,
          fat_100g: 30.9,
          carbohydrates_100g: 57.5,
          sodium_100g: 0.107, // grams → 107 mg
        },
      },
    }),
  );
  const resolver = new Resolver([new OpenFoodFactsProvider()]);
  const r = await resolver.resolveItem(item({ name_en: '3017620422003', name_ru: '3017620422003' }), 'US');
  assert.equal(r.per100.source, 'openfoodfacts');
  assert.equal(r.per100.kcal, 539);
  assert.equal(r.per100.minerals.na, 107);
});
