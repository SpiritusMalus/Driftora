import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, test } from 'node:test';

const realFetch = globalThis.fetch;

process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
process.env.USDA_API_KEY = 'test-usda-key';

// Imported after env is set so providers/clients see the test keys.
const { createApp } = await import('../src/app.js');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function llmReply(items: unknown[]): Response {
  return json({ choices: [{ message: { content: JSON.stringify({ items }) } }] });
}

const usdaHit = {
  foods: [
    {
      description: 'food',
      score: 80,
      foodNutrients: [
        { nutrientNumber: '1008', value: 150 },
        { nutrientNumber: '1003', value: 13 },
        { nutrientNumber: '1004', value: 10 },
        { nutrientNumber: '1005', value: 1 },
        { nutrientNumber: '1093', value: 120 },
      ],
    },
  ],
};

/** Start the app on an ephemeral port and return its base URL + a stopper. */
async function startApp(): Promise<{ base: string; stop: () => Promise<void> }> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function post(base: string, body: unknown): Promise<Response> {
  // The app's own routes must use the real fetch; the mock only intercepts
  // outbound OpenRouter/USDA calls (both on different hosts).
  return realFetch(`${base}/food/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('openrouter.ai')) {
      return llmReply([
        { name_ru: 'яйцо', name_en: 'egg', est_grams: 165, confidence: 0.9 },
        { name_ru: 'тост', name_en: 'toast', est_grams: 30, confidence: 0.8 },
      ]);
    }
    if (url.includes('api.nal.usda.gov')) return json(usdaHit);
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('POST /food/parse → MealDraft with DB-backed per100, recomputed totals, approximate', async () => {
  const { base, stop } = await startApp();
  try {
    const res = await post(base, { text: 'омлет из трёх яиц и тост', region: 'US' });
    assert.equal(res.status, 200);
    const draft = (await res.json()) as Record<string, any>;

    assert.equal(draft.items.length, 2);
    assert.equal(draft.items[0].per100.source, 'usda'); // numbers from the DB
    assert.equal(draft.approximate, true);
    assert.equal(draft.portion_state, 'estimated');
    assert.equal(draft.flags.has_estimate, false);

    // Totals are recomputed server-side from items, not trusted from the model.
    const sumKcal = draft.items.reduce((a: number, it: any) => a + it.scaled.kcal, 0);
    assert.equal(draft.totals.kcal, sumKcal);
  } finally {
    await stop();
  }
});

test('unknown food (USDA miss) → per100.source estimate + has_estimate, no crash', async () => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('openrouter.ai')) {
      return llmReply([{ name_ru: 'нечто', name_en: 'unobtanium stew', est_grams: 200, confidence: 0.4 }]);
    }
    if (url.includes('api.nal.usda.gov')) return json({ foods: [] }); // miss
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const { base, stop } = await startApp();
  try {
    const res = await post(base, { text: 'нечто непонятное', region: 'US' });
    assert.equal(res.status, 200);
    const draft = (await res.json()) as Record<string, any>;
    assert.equal(draft.items[0].per100.source, 'estimate');
    assert.equal(draft.flags.has_estimate, true);
    assert.equal(draft.flags.low_confidence, true);
  } finally {
    await stop();
  }
});

test('region RU → served by the RU table, USDA API never queried', async () => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('openrouter.ai')) {
      return llmReply([{ name_ru: 'куриная грудка', name_en: 'chicken breast', est_grams: 150, confidence: 0.9 }]);
    }
    if (url.includes('api.nal.usda.gov')) throw new Error('USDA must not be called for RU');
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const { base, stop } = await startApp();
  try {
    const res = await post(base, { text: 'куриная грудка', region: 'RU' });
    assert.equal(res.status, 200);
    const draft = (await res.json()) as Record<string, any>;
    assert.equal(draft.region, 'RU');
    // Data is USDA SR Legacy-sourced (honestly attributed), served from the RU
    // table by SkurikhinProvider — the live USDA API is never hit for RU.
    assert.equal(draft.items[0].per100.source, 'usda');
    assert.equal(draft.flags.has_estimate, false);
  } finally {
    await stop();
  }
});

test('empty text → 400 empty_input', async () => {
  const { base, stop } = await startApp();
  try {
    const res = await post(base, { text: '   ', region: 'US' });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, 'empty_input');
  } finally {
    await stop();
  }
});
