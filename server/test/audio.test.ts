import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, test } from 'node:test';

const realFetch = globalThis.fetch;

process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
process.env.USDA_API_KEY = 'test-usda-key';

const { createApp } = await import('../src/app.js');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function llmReply(items: unknown[], heard?: string): Response {
  const payload = heard === undefined ? { items } : { items, heard };
  return json({ choices: [{ message: { content: JSON.stringify(payload) } }] });
}

/// Override the model's next answer for one test (transcript cases).
let nextLlmReply: (() => Response) | null = null;

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
  nextLlmReply = null;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('openrouter.ai')) {
      lastLlmBody = JSON.parse(String(init?.body ?? '{}'));
      if (nextLlmReply) return nextLlmReply();
      return llmReply([{ name_ru: 'омлет', name_en: 'omelette', est_grams: 160, confidence: 0.7 }]);
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

// `Uint8Array<ArrayBuffer>`, not the bare alias: a view over a SharedArrayBuffer
// is not a valid BlobPart, and every caller here builds a plain one.
function audioForm(bytes: Uint8Array<ArrayBuffer>, region: string): FormData {
  const form = new FormData();
  form.append('region', region);
  form.append('audio', new Blob([bytes], { type: 'audio/m4a' }), 'meal.m4a');
  return form;
}

test('POST /food/parse-audio → MealDraft; clip sent to OpenRouter as an input_audio part', async () => {
  const { base, stop } = await startApp();
  try {
    const res = await realFetch(`${base}/food/parse-audio`, {
      method: 'POST',
      body: audioForm(new Uint8Array([1, 2, 3, 4, 5]), 'US'),
    });
    assert.equal(res.status, 200);
    const draft = (await res.json()) as Record<string, any>;
    assert.equal(draft.items.length, 1);
    assert.equal(draft.items[0].per100.source, 'usda');
    assert.equal(draft.approximate, true);

    // The clip reached OpenRouter as base64 input_audio (m4a), never as numbers.
    const userMsg = lastLlmBody.messages.find((m: any) => m.role === 'user');
    const audioPart = userMsg.content.find((p: any) => p.type === 'input_audio');
    assert.ok(audioPart, 'expected an input_audio part');
    assert.equal(audioPart.input_audio.format, 'm4a');
    assert.equal(Buffer.from(audioPart.input_audio.data, 'base64').length, 5);
  } finally {
    await stop();
  }
});

test('POST /food/parse-audio with no file → 400 empty_input', async () => {
  const { base, stop } = await startApp();
  try {
    const form = new FormData();
    form.append('region', 'US');
    const res = await realFetch(`${base}/food/parse-audio`, { method: 'POST', body: form });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, 'empty_input');
  } finally {
    await stop();
  }
});

/// Tester feedback 2026-08-12: on the voice-note path the speech is understood
/// on the SERVER, so a parse that recognised no food left the phone with nothing
/// of the user's at all — the words died inside the request and the entry became
/// «Без названия». The transcript is what gives them back.
test('POST /food/parse-audio returns what was heard, even when no food was recognized', async () => {
  const { base, stop } = await startApp();
  try {
    nextLlmReply = () => llmReply([], 'съел борщ и выпил кофе');
    const res = await realFetch(`${base}/food/parse-audio`, {
      method: 'POST',
      body: audioForm(new Uint8Array([1, 2, 3]), 'RU'),
    });
    assert.equal(res.status, 200);
    const draft = (await res.json()) as Record<string, any>;
    assert.equal(draft.items.length, 0);
    assert.equal(draft.heard, 'съел борщ и выпил кофе');

    // The model must actually be ASKED for it, or the field is decoration.
    const userMsg = lastLlmBody.messages.find((m: any) => m.role === 'user');
    const instruction = userMsg.content.find((p: any) => p.type === 'text').text;
    assert.match(instruction, /heard/);
    assert.ok(lastLlmBody.response_format.json_schema.schema.properties.heard, 'audio schema must declare heard');
  } finally {
    await stop();
  }
});

test('POST /food/parse-audio: a transcript never becomes a food and never a number', async () => {
  const { base, stop } = await startApp();
  try {
    nextLlmReply = () =>
      llmReply([{ name_ru: 'омлет', name_en: 'omelette', est_grams: 160, confidence: 0.7 }], 'я съел омлет');
    const res = await realFetch(`${base}/food/parse-audio`, {
      method: 'POST',
      body: audioForm(new Uint8Array([1, 2, 3]), 'US'),
    });
    const draft = (await res.json()) as Record<string, any>;
    assert.equal(draft.heard, 'я съел омлет');
    // One dish — the sentence did not turn into a second item.
    assert.equal(draft.items.length, 1);
    assert.equal(draft.items[0].name_ru, 'омлет');
  } finally {
    await stop();
  }
});

test('POST /food/parse-audio: a runaway transcript is dropped rather than shipped', async () => {
  const { base, stop } = await startApp();
  try {
    // A decode loop, not speech. Sending a wall of text to the phone as «what
    // you said» would be worse than sending nothing.
    nextLlmReply = () => llmReply([], 'а'.repeat(5000));
    const res = await realFetch(`${base}/food/parse-audio`, {
      method: 'POST',
      body: audioForm(new Uint8Array([1, 2, 3]), 'RU'),
    });
    const draft = (await res.json()) as Record<string, any>;
    assert.equal(draft.heard, undefined);
  } finally {
    await stop();
  }
});

test('the photo and text routes are NOT asked for a transcript', async () => {
  const { base, stop } = await startApp();
  try {
    await realFetch(`${base}/food/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'омлет', region: 'US' }),
    });
    // Changing what this model is asked to emit has caused decode loops before;
    // routes that gain nothing from a transcript keep their old contract.
    assert.equal(lastLlmBody.response_format.json_schema.schema.properties.heard, undefined);
  } finally {
    await stop();
  }
});
