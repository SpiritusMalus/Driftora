import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { Resolver } from '../src/nutrition/resolver.js';
import { UsdaProvider } from '../src/nutrition/usda.js';
import type { NutritionProvider, ProviderResult } from '../src/nutrition/provider.js';
import type { IdentifiedItem, Per100, Region } from '../src/types.js';

const realFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A curated-style primary (skurikhin): macros + one mineral, NO vitamins — the
 *  борщ/каша case the back-fill is meant to enrich. Wins the chain before USDA. */
class StubCurated implements NutritionProvider {
  readonly name = 'skurikhin';
  readonly regions = ['RU', 'US'] as const;
  readonly queryLang = 'ru' as const;
  constructor(private readonly per100: Per100, private readonly displayName: string) {}
  async search(): Promise<ProviderResult | null> {
    return { per100: this.per100, name: this.displayName, confidence: 0.9, prepared: true };
  }
}

/** A crowd OFF-style primary: a dense dry-noodle label, no vitamins. */
class StubOff implements NutritionProvider {
  readonly name = 'openfoodfacts';
  readonly regions = ['RU', 'US'] as const;
  constructor(private readonly per100: Per100, private readonly displayName: string) {}
  async search(): Promise<ProviderResult | null> {
    return { per100: this.per100, name: this.displayName, confidence: 0.8 };
  }
}

/** USDA `foods/search` for "borscht" carrying vitamins + a mineral gap-filler. */
const usdaBorscht = {
  foods: [
    {
      description: 'borscht',
      score: 100,
      foodNutrients: [
        { nutrientNumber: '1008', value: 45 }, // kcal
        { nutrientNumber: '1003', value: 2 }, // protein
        { nutrientNumber: '1004', value: 1.5 }, // fat
        { nutrientNumber: '1005', value: 6 }, // carbs
        { nutrientNumber: '1079', value: 3 }, // dietary fiber (donor-only gap-filler)
        { nutrientNumber: '1092', value: 200 }, // potassium (donor-only)
        { nutrientNumber: '1093', value: 999 }, // sodium (should NOT overwrite primary)
        { nutrientNumber: '1162', value: 10 }, // vitamin C
        { nutrientNumber: '1106', value: 50 }, // vitamin A
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
  return { name_ru: 'борщ', name_en: 'borscht', est_grams: 200, confidence: 0.9, ...over };
}

test('back-fill: curated primary (no vitamins) gets USDA vitamins grafted, macros untouched', async () => {
  mockFetch(() => json(usdaBorscht));
  const curated: Per100 = { source: 'skurikhin', kcal: 50, prot: 3, fat: 2, carb: 6, minerals: { na: 300 } };
  const resolver = new Resolver([new StubCurated(curated, 'борщ'), new UsdaProvider('KEY')]);

  const r = await resolver.resolveItem(item(), 'RU');

  assert.equal(r.per100.source, 'skurikhin', 'primary source is preserved');
  assert.equal(r.per100.kcal, 50, 'macros come from the curated row, not USDA');
  assert.equal(r.per100.vitamins?.c, 10, 'vitamin C grafted from USDA');
  assert.equal(r.per100.vitamins?.a, 50, 'vitamin A grafted from USDA');
  assert.equal(r.per100.minerals.na, 300, 'primary mineral wins on overlap (not USDA 999)');
  assert.equal(r.per100.minerals.k, 200, 'USDA fills the mineral the primary lacked');
  assert.equal(r.per100.fiber, 3, 'fiber grafted from USDA when the curated row lacked it');
  assert.equal(r.micros_estimated, true, 'flagged as a proxy so the client can say so');
  // scaled to 200 g → ×2
  assert.equal(r.scaled.vitamins?.c, 20);
});

test('back-fill: a curated fiber value is never overwritten by the USDA proxy', async () => {
  mockFetch(() => json(usdaBorscht)); // donor carries fiber 3
  const curated: Per100 = { source: 'skurikhin', kcal: 50, prot: 3, fat: 2, carb: 6, fiber: 2.4, minerals: {} };
  const resolver = new Resolver([new StubCurated(curated, 'борщ'), new UsdaProvider('KEY')]);
  const r = await resolver.resolveItem(item(), 'RU');
  assert.equal(r.per100.fiber, 2.4, 'the curated fiber stays — donor 3 does not overwrite a real value');
});

test('back-fill no-op when the primary already carries vitamins (USDA-primary)', async () => {
  mockFetch(() => json(usdaBorscht));
  const resolver = new Resolver([new UsdaProvider('KEY')]);

  const r = await resolver.resolveItem(item(), 'US');
  assert.equal(r.per100.source, 'usda');
  assert.equal(r.micros_estimated, undefined, 'no proxy flag — micros are the real record');
  assert.equal(calls.length, 1, 'no extra donor call when the primary already has vitamins');
});

test('back-fill no-op without a USDA provider in the chain', async () => {
  const curated: Per100 = { source: 'skurikhin', kcal: 50, prot: 3, fat: 2, carb: 6, minerals: {} };
  const resolver = new Resolver([new StubCurated(curated, 'борщ')]);
  const r = await resolver.resolveItem(item(), 'RU');
  assert.equal(r.micros_estimated, undefined);
  assert.equal(r.per100.vitamins, undefined);
});

test('dry_basis: a dense dry-noodle label with a cooked-dish name is flagged', async () => {
  const noodle: Per100 = { source: 'openfoodfacts', kcal: 410, prot: 8, fat: 20, carb: 49, minerals: {} };
  mockFetch(() => json({ foods: [] })); // USDA donor miss — irrelevant to the flag
  const resolver = new Resolver([
    new StubOff(noodle, 'Лапша быстрого приготовления со вкусом курицы'),
    new UsdaProvider('KEY'),
  ]);

  const r = await resolver.resolveItem(
    item({ name_ru: 'лапша быстрого приготовления готовая', name_en: 'instant noodles', prepared: undefined }),
    'RU',
  );
  assert.equal(r.dry_basis, true);
});

test('dry_basis suppressed for a prepared (finished-dish) match', async () => {
  const noodle: Per100 = { source: 'openfoodfacts', kcal: 410, prot: 8, fat: 20, carb: 49, minerals: {} };
  mockFetch(() => json({ foods: [] }));
  // StubCurated marks prepared:true — the finished-dish per-100g is already the
  // cooked state, so the dry-label warning must not fire.
  const resolver = new Resolver([new StubCurated(noodle, 'лапша готовая'), new UsdaProvider('KEY')]);
  const r = await resolver.resolveItem(item({ name_ru: 'лапша готовая', name_en: 'instant noodles' }), 'RU');
  assert.equal(r.dry_basis, undefined);
});
