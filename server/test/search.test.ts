import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, test } from 'node:test';

const realFetch = globalThis.fetch;

process.env.USDA_API_KEY = 'test-usda-key';

const { createApp } = await import('../src/app.js');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Two USDA candidates: a fried rice (higher USDA score) and plain rice.
const usdaRice = {
  foods: [
    {
      description: 'Rice, fried',
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

async function startApp(): Promise<{ base: string; stop: () => Promise<void> }> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function post(base: string, path: string, body: unknown): Promise<Response> {
  return realFetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('api.nal.usda.gov')) return json(usdaRice);
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('POST /food/search → ranked candidates, plain match first', async () => {
  const { base, stop } = await startApp();
  try {
    const res = await post(base, '/food/search', { query: 'rice', region: 'US' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { candidates: { name: string; per100: { kcal: number; source: string } }[] };
    assert.ok(Array.isArray(body.candidates));
    assert.equal(body.candidates[0]?.per100.kcal, 130); // plain "Rice" ranked first
    assert.equal(body.candidates[0]?.per100.source, 'usda');
    assert.equal(body.candidates[1]?.name, 'Rice, fried'); // runner-up
  } finally {
    await stop();
  }
});

test('POST /food/search with empty query → 400', async () => {
  const { base, stop } = await startApp();
  try {
    const res = await post(base, '/food/search', { query: '   ', region: 'US' });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'empty_input');
  } finally {
    await stop();
  }
});

test('POST /food/search RU merges curated + OFF brands; USDA skipped for Cyrillic', async () => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('api.nal.usda.gov')) throw new Error('USDA must not be queried with Cyrillic text');
    if (url.includes('openfoodfacts.org/cgi/search.pl')) {
      return json({
        products: [
          {
            product_name_ru: 'Борщ «Бабушкин» готовый',
            nutriments: {
              'energy-kcal_100g': 55,
              proteins_100g: 1.8,
              fat_100g: 2.5,
              carbohydrates_100g: 6.1,
            },
          },
        ],
      });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;

  const { base, stop } = await startApp();
  try {
    const res = await post(base, '/food/search', { query: 'борщ', region: 'RU' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { candidates: { name: string; per100: { kcal: number; source: string } }[] };
    // Curated table leads (trusted per-100g), the crowd brand is still offered.
    assert.equal(body.candidates[0]?.per100.source, 'skurikhin');
    assert.equal(body.candidates[0]?.per100.kcal, 49);
    assert.ok(
      body.candidates.some((c) => c.per100.source === 'openfoodfacts'),
      'brand results must not be hidden by a curated hit',
    );
  } finally {
    await stop();
  }
});

test('POST /food/search appends an AI estimate card alongside DB rows (ai:true)', async () => {
  process.env.OPENROUTER_API_KEY = 'test-or-key';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('openrouter.ai')) {
      return json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name_ru: 'Масло Простоквашино',
                kcal_100g: 748,
                prot_100g: 0.5,
                fat_100g: 82,
                carb_100g: 0.8,
              }),
            },
          },
        ],
      });
    }
    if (url.includes('openfoodfacts.org/cgi/search.pl')) return json({ products: [] });
    if (url.includes('api.nal.usda.gov')) throw new Error('USDA must not be queried with Cyrillic text');
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;

  const { base, stop } = await startApp();
  try {
    const res = await post(base, '/food/search', { query: 'масло простоквашино', region: 'RU', ai: true });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { candidates: { name: string; per100: { kcal: number; source: string } }[] };
    const ai = body.candidates.find((c) => c.per100.source === 'ai_estimate');
    assert.ok(ai, 'a brand-aware ai_estimate card must be present alongside DB rows');
    assert.equal(ai!.name, 'Масло Простоквашино');
    assert.equal(ai!.per100.kcal, 748);
    // DB rows lead, the AI card is appended last.
    assert.equal(body.candidates[body.candidates.length - 1]!.per100.source, 'ai_estimate');
  } finally {
    delete process.env.OPENROUTER_API_KEY;
    await stop();
  }
});

test('POST /food/search tolerates a typo («гретчка»)', async () => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('openfoodfacts.org/cgi/search.pl')) return json({ products: [] });
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;

  const { base, stop } = await startApp();
  try {
    const res = await post(base, '/food/search', { query: 'гретчка', region: 'RU' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { candidates: { per100: { kcal: number } }[] };
    assert.equal(body.candidates[0]?.per100.kcal, 92); // гречка варёная
  } finally {
    await stop();
  }
});

test('POST /food/search miss → empty candidates, not an error', async () => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('api.nal.usda.gov')) return json({ foods: [] });
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;

  const { base, stop } = await startApp();
  try {
    const res = await post(base, '/food/search', { query: 'unobtanium', region: 'US' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { candidates: unknown[] };
    assert.deepEqual(body.candidates, []);
  } finally {
    await stop();
  }
});
