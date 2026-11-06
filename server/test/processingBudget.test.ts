import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, test } from 'node:test';

import { RESPONSE_BUDGET_MS } from '../src/httpTimeout.js';
import { Resolver } from '../src/nutrition/resolver.js';
import { coercePer100, scaleToGrams, type IdentifiedItem, type NutritionItem, type Region } from '../src/types.js';

process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
process.env.OPENROUTER_PRO_MODEL = '';

const { createApp } = await import('../src/app.js');
const { metrics } = await import('../src/metrics.js');
const realFetch = globalThis.fetch;
// Each test file runs in its own process. Shorten the real production budgets
// here so a never-settling stage is exercised without a 45-second test.
const budgets = RESPONSE_BUDGET_MS as { text: number; upload: number };
const originalBudgets = { ...budgets };
const originalTranslate = process.env.TRANSLATE_DB_LABELS;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function reply(payload: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

const food = { name_ru: 'банан', name_en: 'banana', est_grams: 100, confidence: 0.9 };
let modelReply: () => Promise<Response>;

class TestResolver extends Resolver {
  calls = 0;
  matchedName?: string;
  beforeResolve = async (): Promise<void> => {};

  constructor() { super([]); }

  override async resolveItem(item: IdentifiedItem, _region: Region): Promise<NutritionItem> {
    this.calls += 1;
    await this.beforeResolve();
    const per100 = coercePer100({ source: 'usda', kcal: 89, prot: 1, fat: 0.3, carb: 23 });
    return {
      name_ru: item.name_ru, name_en: item.name_en,
      grams: 100, grams_source: 'estimated', confidence: item.confidence,
      per100, scaled: scaleToGrams(per100, 100), approximate: true,
      ...(this.matchedName ? { matched_name: this.matchedName } : {}),
    };
  }
}

async function startApp(resolver = new TestResolver()) {
  const app = createApp(resolver);
  const writes: number[] = [];
  const sendJson = app.response.json;
  app.response.json = function (body) {
    writes.push(this.statusCode);
    return sendJson.call(this, body);
  };
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`, writes,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function audioForm(): FormData {
  const form = new FormData();
  form.append('region', 'US');
  form.append('audio', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/m4a' }), 'meal.m4a');
  return form;
}

function audioRequest(base: string, path = '/food/parse-audio') {
  return realFetch(`${base}${path}`, {
    method: 'POST', body: audioForm(), signal: AbortSignal.timeout(1500),
  });
}

const drain = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  budgets.text = budgets.upload = 40;
  process.env.TRANSLATE_DB_LABELS = '1';
  modelReply = async () => reply({ items: [food], heard: 'банан' });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('openrouter.ai')) return modelReply();
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(budgets, originalBudgets);
  if (originalTranslate === undefined) delete process.env.TRANSLATE_DB_LABELS;
  else process.env.TRANSLATE_DB_LABELS = originalTranslate;
});

test('audio identification has a total deadline; its late result cannot start resolution or send success', async () => {
  const gate = deferred<Response>();
  modelReply = () => gate.promise; // Deliberately ignores the provider abort signal.
  const resolver = new TestResolver();
  const { base, writes, stop } = await startApp(resolver);
  const before = metrics.snapshot().requests.audio;
  try {
    const res = await audioRequest(base);
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as any).error.code, 'llm_unavailable');
    gate.resolve(reply({ items: [food], heard: 'банан' }));
    await drain();
    await drain();
    assert.equal(resolver.calls, 0, 'expired identification must not start more work');
    assert.deepEqual(writes, [503], 'late work must not write a second response');
    assert.equal(metrics.snapshot().requests.audio, before, 'timeout is not a successful parse');
  } finally {
    gate.resolve(reply({ items: [] }));
    await stop();
  }
});

test('audio resolution shares the identification deadline and cannot send a late draft', async () => {
  const gate = deferred<void>();
  const resolving = deferred<void>();
  const resolver = new TestResolver();
  resolver.beforeResolve = async () => { resolving.resolve(); await gate.promise; };
  const { base, writes, stop } = await startApp(resolver);
  const before = metrics.snapshot().requests.audio;
  try {
    const pending = audioRequest(base);
    await resolving.promise;
    const res = await pending;
    assert.equal(res.status, 503);
    await res.json();
    gate.resolve();
    await drain();
    await drain();
    assert.deepEqual(writes, [503]);
    assert.equal(metrics.snapshot().requests.audio, before);
  } finally {
    gate.resolve();
    await stop();
  }
});

test('workout audio is bounded even if its upstream ignores abort, without a late second response', async () => {
  const gate = deferred<Response>();
  modelReply = () => gate.promise;
  const { base, writes, stop } = await startApp();
  try {
    const res = await audioRequest(base, '/workout/parse-audio');
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as any).error.code, 'llm_unavailable');
    gate.resolve(reply({ workouts: [] }));
    await drain();
    await drain();
    assert.deepEqual(writes, [503]);
  } finally {
    gate.resolve(reply({ workouts: [] }));
    await stop();
  }
});

test('identification and resolution spend one budget rather than receiving one each', async () => {
  budgets.upload = 100;
  modelReply = async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    return reply({ items: [food], heard: 'банан' });
  };
  const resolver = new TestResolver();
  resolver.beforeResolve = () => new Promise((resolve) => setTimeout(resolve, 60));
  const { base, writes, stop } = await startApp(resolver);
  try {
    const res = await audioRequest(base);
    assert.equal(resolver.calls, 1, 'identification completed inside its budget');
    assert.equal(res.status, 503, 'two individually short stages still exceeded the shared budget');
    await res.json();
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(writes, [503]);
  } finally {
    await stop();
  }
});

test('optional translation still falls back to the completed draft when its remaining time runs out', async () => {
  const gate = deferred<Response>();
  let calls = 0;
  modelReply = async () => ++calls === 1 ? reply({ items: [food], heard: 'банан' }) : gate.promise;
  const resolver = new TestResolver();
  resolver.matchedName = 'Uncached budget-test banana';
  const { base, writes, stop } = await startApp(resolver);
  try {
    const res = await realFetch(`${base}/food/parse-audio`, {
      method: 'POST', body: audioForm(), headers: { 'Accept-Language': 'ru' },
      signal: AbortSignal.timeout(1500),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.heard, 'банан');
    assert.equal(body.items[0].matched_name, resolver.matchedName);
    assert.equal(calls, 2, 'translation was actually attempted');
    gate.resolve(reply({ translations: ['Банан'] }));
    await drain();
    await drain();
    assert.deepEqual(writes, [200]);
    assert.equal(body.items[0].matched_name, resolver.matchedName);
  } finally {
    gate.resolve(reply({ translations: [] }));
    await stop();
  }
});

test('a resolution error keeps its internal-error mapping instead of being swallowed as a timeout', async () => {
  budgets.upload = 5000;
  const resolver = new TestResolver();
  resolver.beforeResolve = async () => { throw new Error('synthetic resolver failure'); };
  const { base, stop } = await startApp(resolver);
  try {
    const res = await audioRequest(base);
    assert.equal(res.status, 500);
    assert.equal(((await res.json()) as any).error.code, 'internal_error');
  } finally {
    await stop();
  }
});

test('audio completed inside the budget preserves the draft and transcript', async () => {
  budgets.upload = 5000;
  const { base, writes, stop } = await startApp();
  try {
    const res = await audioRequest(base);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.heard, 'банан');
    assert.equal(body.items[0].per100.source, 'usda');
    assert.equal(body.items[0].grams, 100);
    assert.deepEqual(writes, [200]);
  } finally {
    await stop();
  }
});
