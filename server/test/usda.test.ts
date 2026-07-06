import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { UsdaProvider } from '../src/nutrition/usda.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fdcFetchStub(foods: unknown[]): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ foods }), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
}

test('usda: sends the API key via X-Api-Key header, never in the query string, and bounds the call with a signal', async () => {
  let seenUrl: string | undefined;
  let seenHeaders: HeadersInit | undefined;
  let seenSignal: AbortSignal | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(input);
    seenHeaders = init?.headers;
    seenSignal = init?.signal ?? undefined;
    return new Response(JSON.stringify({ foods: [] }), { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  await new UsdaProvider('super-secret-key').searchMany('rice', 'US');

  assert.ok(seenUrl && !seenUrl.includes('super-secret-key'), 'api key must not leak into the URL/query string');
  assert.ok(seenUrl && !seenUrl.includes('api_key='), 'api_key query param must be gone');
  assert.equal((seenHeaders as Record<string, string> | undefined)?.['X-Api-Key'], 'super-secret-key');
  assert.ok(seenSignal instanceof AbortSignal, 'request must carry a timeout signal');
});

/**
 * The REAL `/foods/search` nutrient shape: modern id in `nutrientId` (number),
 * LEGACY SR number in `nutrientNumber`. Verbatim from the live response for
 * "garlic bread roll" — the record behind the prod "пампушка: 309 ккал ·
 * Белок 0 · Жиры 0 · Углеводы 0" bug (macros were matched against modern ids
 * only, so every USDA hit zero-filled its БЖУ).
 */
const ROLL_GARLIC = {
  description: 'Roll, garlic',
  dataType: 'Survey (FNDDS)',
  foodNutrients: [
    { nutrientId: 1003, nutrientNumber: '203', nutrientName: 'Protein', value: 10.84, unitName: 'G' },
    { nutrientId: 1004, nutrientNumber: '204', nutrientName: 'Total lipid (fat)', value: 6.44, unitName: 'G' },
    { nutrientId: 1005, nutrientNumber: '205', nutrientName: 'Carbohydrate, by difference', value: 51.92, unitName: 'G' },
    { nutrientId: 1008, nutrientNumber: '208', nutrientName: 'Energy', value: 309, unitName: 'KCAL' },
    { nutrientId: 1093, nutrientNumber: '307', nutrientName: 'Sodium, Na', value: 547, unitName: 'MG' },
    { nutrientId: 1079, nutrientNumber: '291', nutrientName: 'Fiber, total dietary', value: 2.0, unitName: 'G' },
    { nutrientId: 2000, nutrientNumber: '269', nutrientName: 'Sugars, total', value: 5.42, unitName: 'G' },
    { nutrientId: 1258, nutrientNumber: '606', nutrientName: 'Fatty acids, total saturated', value: 1.55, unitName: 'G' },
  ],
};

test('usda: parses macros + minerals from the real search shape (legacy nutrientNumber)', async () => {
  globalThis.fetch = fdcFetchStub([ROLL_GARLIC]);

  const results = await new UsdaProvider('test-key').searchMany('garlic bread roll', 'RU');

  assert.equal(results.length, 1);
  const p = results[0]!.per100;
  assert.equal(p.kcal, 309);
  assert.equal(p.prot, 10.84);
  assert.equal(p.fat, 6.44);
  assert.equal(p.carb, 51.92);
  assert.equal(p.minerals.na, 547);
  // Extended label rides along when the record has it.
  assert.equal(p.fiber, 2.0);
  assert.equal(p.sugar, 5.42);
  assert.equal(p.satFat, 1.55);
});

test('usda: still accepts records carrying modern ids in nutrientNumber', async () => {
  globalThis.fetch = fdcFetchStub([
    {
      description: 'Chicken, grilled',
      foodNutrients: [
        { nutrientNumber: '1008', value: 165 },
        { nutrientNumber: '1003', value: 31 },
        { nutrientNumber: '1004', value: 3.6 },
        { nutrientNumber: '1005', value: 0 },
      ],
    },
  ]);

  const results = await new UsdaProvider('test-key').searchMany('grilled chicken', 'US');

  assert.equal(results.length, 1);
  assert.equal(results[0]!.per100.kcal, 165);
  assert.equal(results[0]!.per100.prot, 31);
});

test('usda: a kcal-only record is skipped, never zero-filled', async () => {
  globalThis.fetch = fdcFetchStub([
    {
      // Ranks first (exact name match) but carries energy without a single
      // macro field — must fall through to the next candidate.
      description: 'Garlic bread roll',
      foodNutrients: [{ nutrientId: 1008, nutrientNumber: '208', nutrientName: 'Energy', value: 309, unitName: 'KCAL' }],
    },
    ROLL_GARLIC,
  ]);

  const results = await new UsdaProvider('test-key').searchMany('garlic bread roll', 'RU');

  assert.equal(results.length, 1);
  assert.equal(results[0]!.name, 'Roll, garlic');
  assert.equal(results[0]!.per100.prot, 10.84);
});

test('usda: explicit zero macros (spirits) survive the incomplete-record guard', async () => {
  globalThis.fetch = fdcFetchStub([
    {
      description: 'Alcoholic beverage, distilled, vodka, 80 proof',
      foodNutrients: [
        { nutrientId: 1008, nutrientNumber: '208', value: 231 },
        { nutrientId: 1003, nutrientNumber: '203', value: 0 },
        { nutrientId: 1004, nutrientNumber: '204', value: 0 },
        { nutrientId: 1005, nutrientNumber: '205', value: 0 },
      ],
    },
  ]);

  const results = await new UsdaProvider('test-key').searchMany('vodka', 'US');

  assert.equal(results.length, 1);
  assert.equal(results[0]!.per100.kcal, 231);
  assert.equal(results[0]!.per100.prot, 0);
});
