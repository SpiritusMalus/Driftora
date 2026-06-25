import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, test } from 'node:test';

const realFetch = globalThis.fetch;

process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
process.env.USDA_API_KEY = 'test-usda-key';

import type { CreateAppOptions } from '../src/app.js';
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
      ],
    },
  ],
};

/** Start the app on an ephemeral port with injected limits + a stopper. */
async function startApp(opts: CreateAppOptions): Promise<{ base: string; stop: () => Promise<void> }> {
  const server = createApp(undefined, opts).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** POST text to /food/parse as a given client IP (via X-Forwarded-For). */
function postText(base: string, ip: string): Promise<Response> {
  return realFetch(`${base}/food/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ text: 'омлет', region: 'US' }),
  });
}

/** POST a tiny photo to /food/parse-photo as a given client IP. */
function postPhoto(base: string, ip: string): Promise<Response> {
  const form = new FormData();
  form.append('region', 'US');
  form.append('image', new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/jpeg' }), 'meal.jpg');
  return realFetch(`${base}/food/parse-photo`, {
    method: 'POST',
    headers: { 'X-Forwarded-For': ip },
    body: form,
  });
}

beforeEach(() => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('openrouter.ai')) {
      return llmReply([{ name_ru: 'яйцо', name_en: 'egg', est_grams: 100, confidence: 0.9 }]);
    }
    if (url.includes('api.nal.usda.gov')) return json(usdaHit);
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('text daily cap: under the limit OK, the (N+1)th is 429 with envelope + RateLimit headers', async () => {
  const { base, stop } = await startApp({ limits: { textPerDay: 2, burstPerMin: 1000 } });
  try {
    const ip = '203.0.113.10';
    const a = await postText(base, ip);
    const b = await postText(base, ip);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);

    const over = await postText(base, ip);
    assert.equal(over.status, 429);
    const body = (await over.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, 'rate_limited');
    // The middleware's standard (draft-7) headers survive the custom envelope.
    assert.ok(over.headers.get('ratelimit'), 'RateLimit present');
    assert.ok(over.headers.get('ratelimit-policy'), 'RateLimit-Policy present');
    assert.ok(over.headers.get('retry-after'), 'Retry-After present');
  } finally {
    await stop();
  }
});

test('different client IPs are throttled independently (proves trust-proxy keying)', async () => {
  const { base, stop } = await startApp({ limits: { textPerDay: 1, burstPerMin: 1000 } });
  try {
    assert.equal((await postText(base, '198.51.100.1')).status, 200);
    assert.equal((await postText(base, '198.51.100.1')).status, 429); // first IP exhausted
    // A second IP still has its own fresh bucket.
    assert.equal((await postText(base, '198.51.100.2')).status, 200);
  } finally {
    await stop();
  }
});

test('/health is never rate-limited even under a burst cap of 1', async () => {
  const { base, stop } = await startApp({ limits: { burstPerMin: 1 } });
  try {
    const ip = '203.0.113.20';
    // Spend the burst budget on a real route, then hammer /health.
    await postText(base, ip);
    for (let i = 0; i < 5; i++) {
      const res = await realFetch(`${base}/health`, { headers: { 'X-Forwarded-For': ip } });
      assert.equal(res.status, 200);
    }
  } finally {
    await stop();
  }
});

test('photo cap is tighter: photo trips while text on the same IP still has budget', async () => {
  const { base, stop } = await startApp({ limits: { textPerDay: 5, photoPerDay: 1, burstPerMin: 1000 } });
  try {
    const ip = '203.0.113.30';
    assert.equal((await postPhoto(base, ip)).status, 200);
    assert.equal((await postPhoto(base, ip)).status, 429); // photo cap (1) hit
    // Text on the same IP is unaffected — separate, more generous bucket.
    assert.equal((await postText(base, ip)).status, 200);
  } finally {
    await stop();
  }
});

test('global burst guard trips across mixed routes for one IP', async () => {
  const { base, stop } = await startApp({ limits: { burstPerMin: 2, textPerDay: 1000 } });
  try {
    const ip = '203.0.113.40';
    assert.equal((await postText(base, ip)).status, 200);
    assert.equal((await postText(base, ip)).status, 200);
    const over = await postText(base, ip);
    assert.equal(over.status, 429); // burst budget (2/min) exhausted
    const body = (await over.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, 'rate_limited');
  } finally {
    await stop();
  }
});
