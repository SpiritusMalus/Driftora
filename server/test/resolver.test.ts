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

test('region routing: USDA serves RU as the EN-name fallback', async () => {
  mockFetch(() => json(usdaChicken));
  // USDA now serves BOTH regions; in the RU chain it is queried with the
  // item's English name (queryLang: 'en'), so a RU item still gets real
  // numbers instead of the estimate.
  const resolver = new Resolver([new UsdaProvider('KEY'), new OpenFoodFactsProvider()]);

  const r = await resolver.resolveItem(item(), 'RU');
  assert.equal(r.per100.source, 'usda');
  assert.equal(calls.length, 1, 'USDA answered → OFF is never queried');
  assert.ok(calls[0]!.includes('query=chicken+breast'), 'RU item is queried by its English name');
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

test('complete photo label → source "label", bypasses the DB, net weight sets grams', async () => {
  // A complete panel is ground truth — the resolver must NOT touch a provider.
  mockFetch(() => {
    throw new Error('no provider should be queried when the label is complete');
  });
  const resolver = new Resolver([new UsdaProvider('KEY')]);

  const r = await resolver.resolveItem(
    item({
      name_ru: 'исландский скир',
      name_en: 'skyr',
      // est_grams 150 must lose to the printed net weight 120.
      label: { kcal_100g: 66, prot_100g: 14, fat_100g: 1.2, carb_100g: 1.5, net_weight_g: 120 },
    }),
    'RU',
  );

  assert.equal(r.per100.source, 'label');
  assert.equal(r.per100.prot, 14);
  assert.equal(r.per100.kcal, 66);
  assert.equal(calls.length, 0, 'no DB lookup for a complete label');
  assert.equal(r.matched_name, undefined, 'label numbers are not a DB row');
  assert.equal(r.grams, 120, 'net weight wins over the portion estimate');
  assert.equal(r.scaled.prot, 16.8, '14 * 120 / 100'); // was 0.5 g against the "apple" mismatch
});

test('partial label (no full panel) → DB lookup, but net weight still sets grams', async () => {
  mockFetch(() => json(usdaChicken));
  const resolver = new Resolver([new UsdaProvider('KEY')]);

  // Only protein + weight legible (a front-of-pack callout): must NOT splice a
  // half-label into a DB row, but the net weight is still a real signal.
  const r = await resolver.resolveItem(item({ label: { prot_100g: 14, net_weight_g: 200 } }), 'US');

  assert.equal(r.per100.source, 'usda', 'an incomplete label never overrides the DB composition');
  assert.equal(calls.length, 1);
  assert.equal(r.grams, 200, 'net weight still wins for grams');
  assert.equal(r.scaled.prot, 62, '31 * 200 / 100');
});

test('DB miss + complete AI estimate → source ai_estimate, counted', async () => {
  mockFetch(() => json({ foods: [] })); // USDA miss
  const resolver = new Resolver([new UsdaProvider('KEY')]);
  const r = await resolver.resolveItem(
    item({
      name_ru: 'плескавица',
      name_en: 'pljeskavica',
      est_grams: 200,
      estimate: { kcal_100g: 215, prot_100g: 17, fat_100g: 15, carb_100g: 3 },
    }),
    'US',
  );
  assert.equal(r.per100.source, 'ai_estimate');
  assert.equal(r.per100.kcal, 215);
  assert.equal(r.per100.prot, 17);
  assert.equal(r.scaled.prot, 34, '17 * 200 / 100 — counted, not zeroed like the coarse estimate');
  assert.equal(r.matched_name, undefined, 'AI numbers are not a DB row');
});

test('DB miss + no AI estimate → coarse estimate placeholder', async () => {
  mockFetch(() => json({ foods: [] }));
  const resolver = new Resolver([new UsdaProvider('KEY')]);
  const r = await resolver.resolveItem(item({ name_en: 'unobtanium souffle' }), 'US');
  assert.equal(r.per100.source, 'estimate');
  assert.equal(r.per100.kcal, 150);
});

test('DB hit consistent with the AI estimate → DB wins, not demoted, no AI alternative', async () => {
  mockFetch(() => json(usdaChicken)); // 165 kcal / 31 g protein
  const resolver = new Resolver([new UsdaProvider('KEY')]);
  const r = await resolver.resolveItem(
    item({ estimate: { kcal_100g: 175, prot_100g: 28, fat_100g: 4, carb_100g: 0 } }),
    'US',
  );
  assert.equal(r.per100.source, 'usda');
  assert.ok(r.confidence > 0.3, 'a consistent estimate never demotes the DB');
  assert.ok(!(r.alternatives ?? []).some((a) => a.per100.source === 'ai_estimate'));
});

test('referee: DB hit grossly contradicts the AI estimate → demoted + AI estimate offered', async () => {
  // USDA returns a NAME-plausible «skyr» row (shares the query token, so it
  // survives the relevance filter) whose composition is wrong (protein 0.3 for
  // a high-protein food). The referee — not the relevance filter — is what
  // catches this, so the DB row stays primary but is demoted.
  const badSkyr = {
    foods: [
      {
        description: 'Skyr, plain',
        score: 100,
        foodNutrients: [
          { nutrientNumber: '1008', value: 57 },
          { nutrientNumber: '1003', value: 0.3 },
          { nutrientNumber: '1004', value: 0.2 },
          { nutrientNumber: '1005', value: 14 },
        ],
      },
    ],
  };
  mockFetch(() => json(badSkyr));
  const resolver = new Resolver([new UsdaProvider('KEY')]);
  const r = await resolver.resolveItem(
    item({
      name_ru: 'исландский скир',
      name_en: 'skyr',
      estimate: { kcal_100g: 66, prot_100g: 11, fat_100g: 0.2, carb_100g: 4 },
    }),
    'US',
  );
  assert.equal(r.per100.source, 'usda', 'DB stays primary — the model never overwrites it');
  assert.equal(r.per100.prot, 0.3);
  assert.equal(r.confidence, 0.3, 'referee demotes so the client surfaces the picker');
  assert.equal(r.alternatives?.[0]?.per100.source, 'ai_estimate', 'AI estimate offered as the top switch');
  assert.equal(r.alternatives?.[0]?.per100.prot, 11);
});

test('relevance filter: a name-DISSIMILAR DB row (skyr → apple) is rejected, not demoted', async () => {
  // The other half of the skyr bug: USDA fuzzy-returns «Apple, raw» for a skyr
  // query. Zero name overlap → filtered out entirely → we fall to the honest AI
  // estimate (the correct skyr numbers), instead of adopting apple at all.
  const apple = {
    foods: [
      {
        description: 'Apple, raw',
        score: 100,
        foodNutrients: [
          { nutrientNumber: '1008', value: 57 },
          { nutrientNumber: '1003', value: 0.3 },
        ],
      },
    ],
  };
  mockFetch(() => json(apple));
  const resolver = new Resolver([new UsdaProvider('KEY')]);
  const r = await resolver.resolveItem(
    item({
      name_ru: 'исландский скир',
      name_en: 'skyr',
      estimate: { kcal_100g: 66, prot_100g: 11, fat_100g: 0.2, carb_100g: 4 },
    }),
    'US',
  );
  assert.equal(r.per100.source, 'ai_estimate');
  assert.equal(r.per100.prot, 11); // the correct skyr protein, not apple's 0.3
});

test('graded query (молоко 1.8%) whose match dropped the grade → AI estimate offered, confidence demoted', async () => {
  // A loose crowd hit that carries the WRONG grade («1%») for an «1.8%» query.
  const gradeStub: import('../src/nutrition/provider.js').NutritionProvider = {
    name: 'skurikhin',
    regions: ['RU'],
    async search() {
      return {
        per100: { source: 'openfoodfacts', kcal: 42, prot: 3.4, fat: 1, carb: 5, minerals: {} },
        confidence: 0.85,
        name: 'молоко 1%',
      };
    },
  };
  const resolver = new Resolver([gradeStub]);
  const r = await resolver.resolveItem(
    item({
      name_ru: 'молоко 1.8%',
      name_en: 'milk 1.8%',
      est_grams: 100,
      confidence: 0.8,
      estimate: { kcal_100g: 44, prot_100g: 3, fat_100g: 1.8, carb_100g: 5 },
    }),
    'RU',
  );
  // DB number stays primary, but confidence is knocked down so the client opens the picker…
  assert.equal(r.per100.kcal, 42);
  assert.ok(r.confidence <= 0.3);
  // …and the model's estimate for the ACTUAL grade leads the alternatives.
  assert.ok(r.alternatives && r.alternatives.length >= 1);
  assert.equal(r.alternatives[0].name, 'молоко 1.8%');
  assert.equal(r.alternatives[0].per100.source, 'ai_estimate');
  assert.equal(r.alternatives[0].per100.kcal, 44);
});
