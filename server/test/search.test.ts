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
