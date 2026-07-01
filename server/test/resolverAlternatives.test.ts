import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import type { NutritionProvider, ProviderResult } from '../src/nutrition/provider.js';
import { Resolver } from '../src/nutrition/resolver.js';
import { UsdaProvider } from '../src/nutrition/usda.js';
import type { IdentifiedItem, Per100 } from '../src/types.js';

function per100(kcal: number): Per100 {
  return { source: 'fatsecret', kcal, prot: 1, fat: 1, carb: 1, minerals: {} };
}

function listProvider(results: ProviderResult[]): NutritionProvider {
  return {
    name: 'fake',
    regions: ['US', 'RU'],
    async search(_n, _r) {
      return results[0] ?? null;
    },
    async searchMany(_n, _r) {
      return results;
    },
  };
}

function item(over: Partial<IdentifiedItem> = {}): IdentifiedItem {
  return { name_ru: 'рис', name_en: 'rice', est_grams: 150, confidence: 0.9, ...over };
}

test('primary is the head; runners-up become alternatives (capped at 4)', async () => {
  const results: ProviderResult[] = [
    { per100: per100(100), confidence: 0.9, name: 'Rice' },
    { per100: per100(110), confidence: 0.8, name: 'Rice, fried' },
    { per100: per100(120), confidence: 0.7, name: 'Rice, basmati' },
    { per100: per100(130), confidence: 0.6, name: 'Rice pudding' },
    { per100: per100(140), confidence: 0.5, name: 'Rice cake' },
    { per100: per100(150), confidence: 0.4, name: 'Rice noodles' },
  ];
  const resolver = new Resolver([listProvider(results)]);

  const r = await resolver.resolveItem(item(), 'US');
  assert.equal(r.per100.kcal, 100); // head wins
  assert.ok(r.alternatives);
  assert.equal(r.alternatives!.length, 4); // capped
  assert.deepEqual(
    r.alternatives!.map((a) => a.name),
    ['Rice, fried', 'Rice, basmati', 'Rice pudding', 'Rice cake'],
  );
  assert.equal(r.alternatives![0]!.per100.kcal, 110);
});

test('a weak DB match drags item confidence down (never above identification)', async () => {
  const resolver = new Resolver([listProvider([{ per100: per100(100), confidence: 0.3, name: 'Rice' }])]);
  const r = await resolver.resolveItem(item({ confidence: 0.9 }), 'US');
  assert.equal(r.confidence, 0.3); // min(0.9, 0.3)
  assert.equal(r.alternatives, undefined); // only one candidate → nothing to switch to
});

test('no alternatives field on a full DB miss', async () => {
  const resolver = new Resolver([listProvider([])]);
  const r = await resolver.resolveItem(item(), 'US');
  assert.equal(r.per100.source, 'estimate');
  assert.equal(r.alternatives, undefined);
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {});

test('USDA re-ranks by name: plain "rice" beats a higher-USDA-scored "rice, fried"', async () => {
  const usdaPayload = {
    foods: [
      // USDA's own score puts the fried one first; our name ranking must fix it.
      {
        description: 'Rice, fried, prepared',
        score: 900,
        foodNutrients: [
          { nutrientNumber: '1008', value: 180 },
          { nutrientNumber: '1003', value: 4 },
        ],
      },
      {
        description: 'Rice',
        score: 500,
        foodNutrients: [
          { nutrientNumber: '1008', value: 130 },
          { nutrientNumber: '1003', value: 2.7 },
        ],
      },
    ],
  };
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(usdaPayload), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

  const resolver = new Resolver([new UsdaProvider('KEY')]);
  const r = await resolver.resolveItem(item(), 'US');
  assert.equal(r.per100.kcal, 130); // plain "Rice" won the re-rank
  assert.equal(r.alternatives?.[0]?.name, 'Rice, fried, prepared');
});
