import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { OpenFoodFactsProvider } from '../src/nutrition/openfoodfacts.js';
import type { NutritionProvider, ProviderResult } from '../src/nutrition/provider.js';
import { Resolver } from '../src/nutrition/resolver.js';
import type { IdentifiedItem, Per100 } from '../src/types.js';

function per100(kcal: number): Per100 {
  return { source: 'usda', kcal, prot: 1, fat: 1, carb: 1, minerals: {} };
}

function item(over: Partial<IdentifiedItem> = {}): IdentifiedItem {
  return { name_ru: 'плов', name_en: 'rice pilaf', est_grams: 200, confidence: 0.9, ...over };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---- resolver: per-provider query language ---------------------------------

test('RU chain: an EN-only provider is queried with name_en after the RU table misses', async () => {
  const seen: string[] = [];
  const ruMiss: NutritionProvider = {
    name: 'curated',
    regions: ['RU'],
    async search(n) {
      seen.push(`curated:${n}`);
      return null;
    },
  };
  const enFallback: NutritionProvider = {
    name: 'usda-like',
    regions: ['US', 'RU'],
    queryLang: 'en',
    async search(n) {
      seen.push(`en:${n}`);
      return { per100: per100(160), confidence: 0.8, name: 'Rice pilaf' };
    },
  };
  const resolver = new Resolver([ruMiss, enFallback]);

  const r = await resolver.resolveItem(item(), 'RU');
  assert.equal(r.per100.kcal, 160);
  // The RU table saw the Russian name; the EN source saw the English one.
  assert.deepEqual(seen, ['curated:плов', 'en:rice pilaf']);
});

test('RU chain: a curated RU hit wins before the EN fallback is ever queried', async () => {
  let enCalled = false;
  const ruHit: NutritionProvider = {
    name: 'curated',
    regions: ['RU'],
    async search() {
      return { per100: per100(49), confidence: 1, name: 'борщ' };
    },
  };
  const enFallback: NutritionProvider = {
    name: 'usda-like',
    regions: ['US', 'RU'],
    queryLang: 'en',
    async search() {
      enCalled = true;
      return { per100: per100(999), confidence: 0.9, name: 'Borscht' };
    },
  };
  const resolver = new Resolver([ruHit, enFallback]);

  const r = await resolver.resolveItem(item({ name_ru: 'борщ', name_en: 'borscht' }), 'RU');
  assert.equal(r.per100.kcal, 49);
  assert.equal(enCalled, false);
});

test('queryLang falls back to the native name when the preferred one is empty', async () => {
  const seen: string[] = [];
  const enOnly: NutritionProvider = {
    name: 'usda-like',
    regions: ['US', 'RU'],
    queryLang: 'en',
    async search(n) {
      seen.push(n);
      return { per100: per100(100), confidence: 0.8, name: 'x' };
    },
  };
  const resolver = new Resolver([enOnly]);

  await resolver.resolveItem(item({ name_ru: 'гречка', name_en: '' }), 'RU');
  assert.deepEqual(seen, ['гречка']);
});

// ---- Open Food Facts free-text search --------------------------------------

interface OffProductRow {
  product_name?: string;
  product_name_ru?: string;
  nutriments?: Record<string, number | string>;
}

function offFetchStub(hits: OffProductRow[], onUrl?: (url: string) => void): typeof fetch {
  return (async (input: string | URL | Request) => {
    onUrl?.(String(input));
    return new Response(JSON.stringify({ hits }), { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

test('OFF search: RU region asks for RU names and drops incomplete rows', async () => {
  let requested = '';
  globalThis.fetch = offFetchStub(
    [
      // Incomplete row (no fat) — must be dropped, not zero-filled.
      { product_name_ru: 'Сырок неполный', nutriments: { 'energy-kcal_100g': 200, proteins_100g: 10, carbohydrates_100g: 20 } },
      {
        product_name: 'Glazed curd bar',
        product_name_ru: 'Сырок глазированный',
        nutriments: { 'energy-kcal_100g': 407, proteins_100g: 8.5, fat_100g: 27.8, carbohydrates_100g: 32 },
      },
    ],
    (u) => {
      requested = u;
    },
  );

  const off = new OpenFoodFactsProvider();
  const results = await off.searchMany('сырок глазированный', 'RU');

  assert.ok(requested.startsWith('https://search.openfoodfacts.org/search'));
  assert.ok(requested.includes('langs=ru'));
  assert.equal(results.length, 1);
  assert.equal(results[0]!.name, 'Сырок глазированный');
  assert.equal(results[0]!.per100.kcal, 407);
  assert.equal(results[0]!.per100.source, 'openfoodfacts');
  assert.ok(results[0]!.confidence <= 0.85); // crowd data never reads as curated-grade
});

test('OFF search: kJ-only rows convert to kcal', async () => {
  globalThis.fetch = offFetchStub([
    {
      product_name: 'Ryazhenka',
      product_name_ru: 'Ряженка',
      nutriments: { 'energy-kj_100g': 251, proteins_100g: 2.9, fat_100g: 2.5, carbohydrates_100g: 4.2 },
    },
  ]);

  const off = new OpenFoodFactsProvider();
  const results = await off.searchMany('ряженка', 'RU');
  assert.equal(results.length, 1);
  assert.equal(results[0]!.per100.kcal, 60); // 251 kJ ≈ 60 kcal
});

test('OFF search: a barcode delegates to the exact product lookup', async () => {
  let requested = '';
  globalThis.fetch = (async (input: string | URL | Request) => {
    requested = String(input);
    return new Response(
      JSON.stringify({
        status: 1,
        product: { nutriments: { 'energy-kcal_100g': 52, proteins_100g: 3, fat_100g: 1.5, carbohydrates_100g: 5 } },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  const off = new OpenFoodFactsProvider();
  const results = await off.searchMany('4600000000000', 'RU');
  assert.ok(requested.includes('/api/v2/product/4600000000000'));
  assert.equal(results.length, 1);
  assert.equal(results[0]!.per100.kcal, 52);
});

test('OFF search: network failure yields an empty list, never a throw', async () => {
  globalThis.fetch = (async () => {
    throw new Error('boom');
  }) as typeof fetch;

  const off = new OpenFoodFactsProvider();
  assert.deepEqual(await off.searchMany('кефир', 'RU'), []);
});
