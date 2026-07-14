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
    if (url.includes('api.nal.usda.gov')) {
      // Echo the queried name as the description — a realistic USDA hit (the
      // resolver now drops rows that share NO token with the query, so a static
      // 'food' placeholder would no longer resolve).
      const q = new URL(url).searchParams.get('query') ?? 'food';
      return json({ foods: [{ ...usdaHit.foods[0], description: q }] });
    }
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

function postTo(base: string, path: string, body: unknown): Promise<Response> {
  return realFetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('POST /food/search: empty DB + ai:true → an honest ai_estimate candidate (never a dead end)', async () => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('openrouter.ai')) {
      // The manual-search estimator returns a flat per-100g object (not the
      // identify `items` shape) — brand/intent-aware, always complete.
      return json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name_ru: 'загадочный батончик',
                kcal_100g: 350,
                prot_100g: 30,
                fat_100g: 10,
                carb_100g: 40,
              }),
            },
          },
        ],
      });
    }
    if (url.includes('openfoodfacts')) return json({ products: [] });
    if (url.includes('api.nal.usda.gov')) return json({ foods: [] });
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const { base, stop } = await startApp();
  try {
    // Cyrillic RU query the curated table misses → DB empty → only the AI card.
    const res = await postTo(base, '/food/search', { query: 'загадочный батончик', region: 'RU', ai: true });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { candidates: any[] };
    assert.equal(data.candidates.length, 1);
    assert.equal(data.candidates[0].per100.source, 'ai_estimate');
    assert.equal(data.candidates[0].per100.kcal, 350);
    assert.equal(data.candidates[0].per100.prot, 30);
  } finally {
    await stop();
  }
});

test('POST /food/search: empty DB WITHOUT ai consent → stays empty, LLM never called', async () => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('openrouter.ai')) throw new Error('LLM must NOT be called without ai consent');
    if (url.includes('openfoodfacts')) return json({ products: [] });
    if (url.includes('api.nal.usda.gov')) return json({ foods: [] });
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const { base, stop } = await startApp();
  try {
    const res = await postTo(base, '/food/search', { query: 'загадочный батончик', region: 'RU' });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { candidates: any[] };
    assert.equal(data.candidates.length, 0);
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

/** POST helper for the workout endpoint (same real-fetch rationale as `post`). */
function postWorkout(base: string, body: unknown): Promise<Response> {
  return realFetch(`${base}/workout/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function workoutReply(workouts: unknown[]): Response {
  return json({ choices: [{ message: { content: JSON.stringify({ workouts }) } }] });
}

test('POST /workout/parse → structured activities, no energy numbers on the wire', async () => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('openrouter.ai')) {
      return workoutReply([
        { type: 'strength', name_ru: 'отжимания', minutes: 8, confidence: 0.8 },
        { type: 'run', name_ru: 'бег', minutes: 20, speed_kmh: 10, confidence: 0.9 },
      ]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const { base, stop } = await startApp();
  try {
    const res = await postWorkout(base, { text: '100 отжиманий и пробежка 20 минут' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { workouts: any[] };
    assert.equal(body.workouts.length, 2);
    assert.equal(body.workouts[0].type, 'strength');
    assert.equal(body.workouts[0].name_ru, 'отжимания');
    assert.equal(body.workouts[1].speed_kmh, 10);
    // No calories anywhere in the payload — the client computes them on-device.
    assert.ok(!JSON.stringify(body).toLowerCase().includes('kcal'));
  } finally {
    await stop();
  }
});

test('POST /workout/parse rejects empty input with 400', async () => {
  const { base, stop } = await startApp();
  try {
    const res = await postWorkout(base, { text: '   ' });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'empty_input');
  } finally {
    await stop();
  }
});
