import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { FatSecretProvider, parsePer100 } from '../src/nutrition/fatsecret.js';

const realFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

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

const banana = {
  foods: {
    food: [
      {
        food_name: 'Banana',
        food_description: 'Per 100g - Calories: 89kcal | Fat: 0.33g | Carbs: 22.84g | Protein: 1.09g',
      },
    ],
  },
};

test('parsePer100: accepts a Per 100g row, attributes the fatsecret source', () => {
  const per100 = parsePer100('Per 100g - Calories: 89kcal | Fat: 0.33g | Carbs: 22.84g | Protein: 1.09g');
  assert.ok(per100);
  assert.equal(per100.source, 'fatsecret');
  assert.equal(per100.kcal, 89);
  assert.equal(per100.prot, 1.09);
  assert.equal(per100.fat, 0.33);
  assert.equal(per100.carb, 22.84);
});

test('parsePer100: rejects a per-serving row with NO recoverable gram basis', () => {
  assert.equal(parsePer100('Per 1 cup - Calories: 200kcal | Fat: 1g'), null);
  assert.equal(parsePer100('Per 2 tbsp - Calories: 60kcal | Fat: 4g', 'Tvorog'), null);
});

test('parsePer100: scales a per-serving row when grams are in the description', () => {
  // "Per 1 serving (58 g)" → ×(100/58) to 100 g.
  const p = parsePer100('Per 1 bar (58 g) - Calories: 250kcal | Fat: 12g | Carbs: 32g | Protein: 4g');
  assert.ok(p);
  assert.equal(p.kcal, Math.round(250 * 100 / 58)); // 431
  assert.equal(p.prot, Math.round(4 * 100 / 58 * 100) / 100); // 6.9
});

test('parsePer100: recovers grams from the food NAME (oz) for brand rows', () => {
  // Snickers-style: grams live in the name "(1.86 oz)", not the description.
  const p = parsePer100('Per 1 bar - Calories: 250kcal | Fat: 12g | Carbs: 32g | Protein: 4g', 'Snickers Bar (1.86 oz)');
  assert.ok(p);
  const grams = 1.86 * 28.3495; // ≈52.7
  assert.equal(p.kcal, Math.round(250 * 100 / grams)); // ≈474
});

test('disabled without credentials — never touches the network', async () => {
  mockFetch(() => json(banana));
  const provider = new FatSecretProvider('', '');
  assert.equal(await provider.search('banana', 'US'), null);
  assert.equal(calls.length, 0);
});

test('fetches a token then searches, returning the parsed per-100g', async () => {
  mockFetch((url) => {
    if (url.includes('oauth')) return json({ access_token: 'tok', expires_in: 86400 });
    return json(banana);
  });
  const provider = new FatSecretProvider('id', 'secret');
  const result = await provider.search('банан', 'RU');
  assert.ok(result);
  assert.equal(result.per100.source, 'fatsecret');
  assert.equal(result.per100.kcal, 89);

  // RU search is localized + the token is reused (no second oauth round-trip).
  const search = calls.find((u) => u.includes('server.api'));
  assert.ok(search?.includes('region=RU'));
  assert.ok(search?.includes('language=ru'));
  await provider.search('яблоко', 'RU');
  assert.equal(calls.filter((u) => u.includes('oauth')).length, 1);
});
