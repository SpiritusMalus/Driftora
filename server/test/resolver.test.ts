import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { OpenFoodFactsProvider } from '../src/nutrition/openfoodfacts.js';
import { Resolver } from '../src/nutrition/resolver.js';
import { UsdaProvider } from '../src/nutrition/usda.js';
import type { NutritionProvider } from '../src/nutrition/provider.js';
import { coercePer100, type IdentifiedItem } from '../src/types.js';

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

test('graded query (молоко 1.8%) whose DB grade differs → AI estimate becomes PRIMARY, DB row an alternative', async () => {
  // The DB only carries a DIFFERENT grade («1%») for an «1.8%» query.
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
  // The AI estimate for the REQUESTED grade is now the primary (flagged «≈»)…
  assert.equal(r.per100.source, 'ai_estimate');
  assert.equal(r.per100.kcal, 44);
  // …and the real-but-wrong-grade DB row is the fallback alternative.
  assert.ok(r.alternatives && r.alternatives.length >= 1);
  assert.equal(r.alternatives[0].name, 'молоко 1%');
  assert.equal(r.alternatives[0].per100.source, 'openfoodfacts');
  assert.equal(r.alternatives[0].per100.kcal, 42);
});

test('weak match: a one-token DB hit loses to the AI estimate (тархун → «Tarragon, dried»)', async () => {
  // The lemonade bug, end to end. USDA fuzzy-returns «Tarragon, dried» for
  // «tarragon soda Chernogolovka»: it shares ONE token of three, so the row
  // survives the relevance filter (overlap > 0) and used to stop the chain at
  // confidence 0.4 — serving a dried herb, 295 kcal and 22.8 g protein, as a
  // bottle of soda (974 kcal for 330 ml; the real drink is ~20-40 kcal/100 ml).
  // Coverage 1/3 now marks it weak, so the model's class-level estimate wins.
  const driedTarragon = {
    foods: [
      {
        description: 'Tarragon, dried',
        score: 100,
        foodNutrients: [
          { nutrientNumber: '1008', value: 295 },
          { nutrientNumber: '1003', value: 22.8 },
          { nutrientNumber: '1004', value: 7.2 },
          { nutrientNumber: '1005', value: 50.2 },
        ],
      },
    ],
  };
  mockFetch(() => json(driedTarragon));
  const resolver = new Resolver([new UsdaProvider('KEY')]);
  const r = await resolver.resolveItem(
    item({
      name_ru: 'лимонад тархун черноголовка',
      name_en: 'tarragon soda Chernogolovka',
      estimate: { kcal_100g: 30, prot_100g: 0, fat_100g: 0, carb_100g: 8 },
    }),
    'RU',
  );
  assert.equal(r.per100.source, 'ai_estimate', 'a thin herb match must not pass as the drink');
  assert.equal(r.per100.kcal, 30);
  assert.equal(r.per100.prot, 0);
  assert.ok(
    (r.alternatives ?? []).some((a) => a.per100.kcal === 295),
    'the thin DB row stays available as a one-tap alternative',
  );
});

test('estimate: a model kcal that grossly contradicts its own macros is overridden by the formula', async () => {
  // Estimate becomes primary via the same one-token weak match. But here the
  // model's estimate is self-contradictory — 400 kcal against macros that sum to
  // ~57 (a fat↔carb transposition, or a per-serving kcal left on per-100g macros).
  // The card must never show 400 next to 2/1/10 g, so the macro-derived value
  // takes over (docs/nutrition-science.md §1).
  mockFetch(() =>
    json({
      foods: [
        { description: 'Tarragon, dried', score: 100, foodNutrients: [{ nutrientNumber: '1008', value: 295 }] },
      ],
    }),
  );
  const resolver = new Resolver([new UsdaProvider('KEY')]);
  const r = await resolver.resolveItem(
    item({
      name_ru: 'лимонад тархун',
      name_en: 'tarragon soda',
      estimate: { kcal_100g: 400, prot_100g: 2, fat_100g: 1, carb_100g: 10 },
    }),
    'RU',
  );
  assert.equal(r.per100.source, 'ai_estimate');
  assert.equal(r.per100.kcal, 57); // 4·2 + 9·1 + 4·10 — not the contradictory 400
});

test('dry-basis: a dry rice row offers a cooked-basis alternative (÷ yield factor)', async () => {
  // A dense «рис» row (a dry-product label, 360 kcal/100 g) matched against a
  // cooked weight overcounts ~3×. The warning fires AND the cooked version
  // (per-100g ÷ 2.9) is offered as the top one-tap alternative — the user still
  // decides, since they may have weighed it dry (docs/nutrition-science.md §6).
  const riceStub: NutritionProvider = {
    name: 'usda',
    regions: ['RU', 'US'],
    async search() {
      return {
        per100: coercePer100({ source: 'usda', kcal: 360, prot: 7, fat: 1, carb: 80 }),
        confidence: 0.95,
        name: 'Rice, white, dry',
      };
    },
  };
  const resolver = new Resolver([riceStub]);
  const r = await resolver.resolveItem(item({ name_ru: 'рис', name_en: 'rice', est_grams: 150 }), 'RU');
  assert.equal(r.dry_basis, true, 'the dry-product overcount is flagged');
  const cooked = (r.alternatives ?? []).find((a) => a.name?.includes('готовое'));
  assert.ok(cooked, 'a cooked-basis alternative is offered');
  assert.equal(cooked?.per100.kcal, 124); // 360 / 2.9
});

test('weak match with NO estimate is demoted, not served as a confident hit', async () => {
  // Same thin match, but the model gave no estimate to fall back on. We still
  // must not present it as fact: confidence drops so the client opens the picker.
  const driedTarragon = {
    foods: [
      {
        description: 'Tarragon, dried',
        score: 100,
        foodNutrients: [
          { nutrientNumber: '1008', value: 295 },
          { nutrientNumber: '1003', value: 22.8 },
          { nutrientNumber: '1004', value: 7.2 },
          { nutrientNumber: '1005', value: 50.2 },
        ],
      },
    ],
  };
  mockFetch(() => json(driedTarragon));
  const resolver = new Resolver([new UsdaProvider('KEY')]);
  const r = await resolver.resolveItem(
    item({ name_ru: 'лимонад тархун черноголовка', name_en: 'tarragon soda Chernogolovka' }),
    'RU',
  );
  assert.equal(r.confidence, 0.3, 'thin match is flagged, so the picker opens');
});

test('a covering match still stops the chain (no regression for normal foods)', async () => {
  mockFetch(() => json(usdaChicken));
  const resolver = new Resolver([new UsdaProvider('KEY'), new OpenFoodFactsProvider()]);
  const r = await resolver.resolveItem(item(), 'US');
  assert.equal(r.per100.source, 'usda', '«chicken breast» → «Chicken, breast, raw» covers the query');
  assert.ok(r.confidence > 0.3);
});

test('resolve: a DB miss is filled by the text-only estimator, not left coarse', async () => {
  // The photo path carries no `estimate` of its own any more (the numeric fields
  // were where the vision model's decode loop lived), so the fallback moved into
  // its own cheap call over the food NAME. Without it, every DB miss from a
  // photo would render as the flat 150/5/5/20 placeholder.
  let asked = '';
  const resolver = new Resolver([], async (name) => {
    asked = name;
    return { name, kcal: 480, prot: 4.5, fat: 25, carb: 61 };
  });

  const r = await resolver.resolveItem(
    { name_ru: 'шоколад Бабаевский', name_en: 'Babaevsky chocolate', est_grams: 50, confidence: 0.9 },
    'RU',
  );

  assert.equal(asked, 'шоколад Бабаевский', 'estimator is asked with the region-native name');
  assert.equal(r.per100.source, 'ai_estimate');
  assert.equal(r.per100.kcal, 480);
});

test('resolve: a failing estimator degrades to the placeholder, never throws', async () => {
  const resolver = new Resolver([], async () => {
    throw new Error('upstream down');
  });

  const r = await resolver.resolveItem(
    { name_ru: 'нечто', name_en: 'something', est_grams: 100, confidence: 0.5 },
    'RU',
  );

  assert.equal(r.per100.source, 'estimate', 'coarse placeholder, not a crash');
});

test('resolve: a WEAK match is refereed by the on-demand estimate, which becomes primary', async () => {
  // The regression this closes: dropping `estimate` from the photo schema left
  // thin matches with nothing to be checked against, so «Бабаевский» passed a
  // 329 kcal USDA row off as fact for a ~490 kcal bar. The referee now fetches
  // its band on demand — but only for matches already under suspicion.
  let asked = 0;
  const thin: NutritionProvider = {
    name: 'usda',
    regions: ['RU', 'US'],
    queryLang: 'en',
    async search() {
      return {
        name: 'cocoa mass',
        per100: coercePer100({ source: 'usda', kcal: 329, prot: 4.4, fat: 23.9, carb: 25.2 }),
        confidence: 0.9,
      };
    },
  };

  const resolver = new Resolver([thin], async () => {
    asked += 1;
    return { name: 'шоколад', kcal: 490, prot: 4.5, fat: 25, carb: 61 };
  });

  const r = await resolver.resolveItem(
    { name_ru: 'шоколад Бабаевский с помадно-сливочной начинкой', name_en: 'Babaevsky chocolate', est_grams: 50, confidence: 0.9 },
    'RU',
  );

  assert.equal(asked, 1, 'the band is fetched for the suspicious row');
  assert.equal(r.per100.source, 'ai_estimate', 'estimate is primary over a thin row');
  // The model's kcal (490) reconciles with its own macros (4·4.5 + 9·25 + 4·61 =
  // 487, a 0.6% gap) → kept as-is; the macro-derived override only fires on gross
  // self-contradiction (docs/nutrition-science.md §1).
  assert.equal(r.per100.kcal, 490);
  assert.ok(
    r.alternatives?.some((a) => a.per100.kcal === 329),
    'the thin DB row survives as a one-tap alternative',
  );
});

test('resolve: a CLEAN match costs no extra estimate call', async () => {
  // The referee must not turn a good five-component plate into five extra LLM
  // round-trips — that was the whole point of moving numbers out of the photo call.
  let asked = 0;
  const solid: NutritionProvider = {
    name: 'usda',
    regions: ['RU', 'US'],
    queryLang: 'en',
    async search() {
      return {
        name: 'cherry tomatoes',
        per100: coercePer100({ source: 'usda', kcal: 18, prot: 0.9, fat: 0.2, carb: 3.9 }),
        confidence: 0.95,
      };
    },
  };

  const resolver = new Resolver([solid], async () => {
    asked += 1;
    return { name: 'x', kcal: 1, prot: 1, fat: 1, carb: 1 };
  });

  const r = await resolver.resolveItem(
    { name_ru: 'помидоры черри', name_en: 'cherry tomatoes', est_grams: 100, confidence: 0.9 },
    'RU',
  );

  assert.equal(asked, 0, 'a confident row is not second-guessed');
  assert.equal(r.per100.kcal, 18);
});
