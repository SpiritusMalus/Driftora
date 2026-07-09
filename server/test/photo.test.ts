import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, test } from 'node:test';

const realFetch = globalThis.fetch;

process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
process.env.USDA_API_KEY = 'test-usda-key';

const { createApp, sniffImageMime } = await import('../src/app.js');

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

let lastLlmBody: any = null;

async function startApp(): Promise<{ base: string; stop: () => Promise<void> }> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

beforeEach(() => {
  lastLlmBody = null;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('openrouter.ai')) {
      lastLlmBody = JSON.parse(String(init?.body ?? '{}'));
      return llmReply([{ name_ru: 'яичница', name_en: 'fried eggs', est_grams: 120, confidence: 0.7 }]);
    }
    if (url.includes('api.nal.usda.gov')) {
      // Echo the queried name — a realistic USDA hit (the resolver now drops
      // rows that share NO token with the query).
      const q = new URL(url).searchParams.get('query') ?? 'food';
      return json({ foods: [{ ...usdaHit.foods[0], description: q }] });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function photoForm(bytes: Uint8Array, region: string): FormData {
  const form = new FormData();
  form.append('region', region);
  form.append('image', new Blob([bytes], { type: 'image/jpeg' }), 'meal.jpg');
  return form;
}

test('POST /food/parse-photo → MealDraft; image sent to OpenRouter as a data URL', async () => {
  const { base, stop } = await startApp();
  try {
    const res = await realFetch(`${base}/food/parse-photo`, {
      method: 'POST',
      body: photoForm(new Uint8Array([1, 2, 3, 4, 5]), 'US'),
    });
    assert.equal(res.status, 200);
    const draft = (await res.json()) as Record<string, any>;
    assert.equal(draft.items.length, 1);
    assert.equal(draft.items[0].per100.source, 'usda');
    assert.equal(draft.approximate, true);

    // The photo reached OpenRouter as a base64 data URL, not as nutrition numbers.
    const userMsg = lastLlmBody.messages.find((m: any) => m.role === 'user');
    const imgPart = userMsg.content.find((p: any) => p.type === 'image_url');
    assert.ok(imgPart, 'expected an image_url part');
    const dataUrl: string = imgPart.image_url.url;
    const prefix = 'data:image/jpeg;base64,';
    assert.ok(dataUrl.startsWith(prefix), 'expected a jpeg data URL');
    assert.equal(Buffer.from(dataUrl.slice(prefix.length), 'base64').length, 5);
  } finally {
    await stop();
  }
});

// A gallery upload can be ANY format under the client's blanket 'image/jpeg'
// label (the app re-encodes, but older/foreign clients may not) — the data URL
// must carry the type the bytes actually are, or the vision call gets flaky.
test('POST /food/parse-photo relabels a mislabeled upload from its magic bytes', async () => {
  const { base, stop } = await startApp();
  try {
    // Real PNG signature, declared as image/jpeg by the form (photoForm does).
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const res = await realFetch(`${base}/food/parse-photo`, { method: 'POST', body: photoForm(png, 'US') });
    assert.equal(res.status, 200);

    const userMsg = lastLlmBody.messages.find((m: any) => m.role === 'user');
    const imgPart = userMsg.content.find((p: any) => p.type === 'image_url');
    assert.ok(imgPart.image_url.url.startsWith('data:image/png;base64,'), 'expected the sniffed png type');
  } finally {
    await stop();
  }
});

test('sniffImageMime: known signatures detected, unknown left undefined', () => {
  const ftyp = (brand: string): Buffer =>
    Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from(`ftyp${brand}`, 'ascii'), Buffer.alloc(8)]);

  assert.equal(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffImageMime(Buffer.from('GIF89a....', 'ascii')), 'image/gif');
  const webp = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii')]);
  assert.equal(sniffImageMime(webp), 'image/webp');
  assert.equal(sniffImageMime(ftyp('heic')), 'image/heic'); // iPhone default
  assert.equal(sniffImageMime(ftyp('mif1')), 'image/heif');
  assert.equal(sniffImageMime(ftyp('avif')), 'image/avif');
  // Unknown bytes: no relabel — the route keeps the declared mime as before.
  assert.equal(sniffImageMime(Buffer.from([1, 2, 3, 4, 5])), undefined);
  assert.equal(sniffImageMime(Buffer.alloc(0)), undefined);
});

test('POST /food/parse-photo with no file → 400 empty_input', async () => {
  const { base, stop } = await startApp();
  try {
    const form = new FormData();
    form.append('region', 'US');
    const res = await realFetch(`${base}/food/parse-photo`, { method: 'POST', body: form });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, 'empty_input');
  } finally {
    await stop();
  }
});
