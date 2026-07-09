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

/** OpenRouter-shaped reply whose content is a workout-parse payload. */
function llmWorkoutReply(payload: unknown): Response {
  return json({ choices: [{ message: { content: JSON.stringify(payload) } }] });
}

let lastLlmBody: any = null;
let nextLlmPayload: unknown = { workouts: [] };

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
  nextLlmPayload = { workouts: [] };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('openrouter.ai')) {
      lastLlmBody = JSON.parse(String(init?.body ?? '{}'));
      return llmWorkoutReply(nextLlmPayload);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('POST /workout/parse-audio → { workouts }; clip rides as input_audio, kcal never crosses the wire', async () => {
  nextLlmPayload = {
    workouts: [{ type: 'strength', name_ru: 'жим лёжа', minutes: 12, sets: 4, confidence: 0.9 }],
  };
  const { base, stop } = await startApp();
  try {
    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/m4a' }), 'workout.m4a');
    const res = await realFetch(`${base}/workout/parse-audio`, { method: 'POST', body: form });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { workouts: any[] };
    assert.equal(body.workouts.length, 1);
    assert.equal(body.workouts[0].type, 'strength');
    assert.equal(body.workouts[0].sets, 4);

    const userMsg = lastLlmBody.messages.find((m: any) => m.role === 'user');
    const audioPart = userMsg.content.find((p: any) => p.type === 'input_audio');
    assert.ok(audioPart, 'expected an input_audio part');
    assert.equal(audioPart.input_audio.format, 'm4a');
  } finally {
    await stop();
  }
});

test('POST /workout/parse-audio with no file → 400 empty_input', async () => {
  const { base, stop } = await startApp();
  try {
    const res = await realFetch(`${base}/workout/parse-audio`, { method: 'POST', body: new FormData() });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, 'empty_input');
  } finally {
    await stop();
  }
});

test('POST /workout/parse-photo → activities + the tracker’s printed totals pass through', async () => {
  nextLlmPayload = {
    workouts: [{ type: 'run', name_ru: 'бег 5 км', minutes: 31, confidence: 0.8 }],
    device_kcal: 412.4,
    device_minutes: 31.4,
  };
  const { base, stop } = await startApp();
  try {
    const form = new FormData();
    // A real JPEG magic prefix so sniffImageMime recognizes the bytes.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    form.append('image', new Blob([jpeg], { type: 'image/jpeg' }), 'workout.jpg');
    const res = await realFetch(`${base}/workout/parse-photo`, { method: 'POST', body: form });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { workouts: any[]; device_kcal?: number; device_minutes?: number };
    assert.equal(body.workouts.length, 1);
    assert.equal(body.device_kcal, 412); // transcribed, rounded — not re-derived
    assert.equal(body.device_minutes, 31);

    const userMsg = lastLlmBody.messages.find((m: any) => m.role === 'user');
    const imagePart = userMsg.content.find((p: any) => p.type === 'image_url');
    assert.ok(imagePart, 'expected an image_url part');
    assert.ok(String(imagePart.image_url.url).startsWith('data:image/jpeg;base64,'));
  } finally {
    await stop();
  }
});

test('POST /workout/parse-photo: an implausible device_kcal is dropped, activities survive', async () => {
  nextLlmPayload = {
    workouts: [{ type: 'walk', name_ru: 'ходьба', minutes: 60, confidence: 0.9 }],
    device_kcal: 10_000, // steps misread as kcal — must not become a 10k-kcal day
  };
  const { base, stop } = await startApp();
  try {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }), 'w.jpg');
    const res = await realFetch(`${base}/workout/parse-photo`, { method: 'POST', body: form });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { workouts: any[]; device_kcal?: number };
    assert.equal(body.device_kcal, undefined);
    assert.equal(body.workouts.length, 1);
  } finally {
    await stop();
  }
});
