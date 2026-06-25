import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

const realFetch = globalThis.fetch;

process.env.OPENROUTER_API_KEY = 'k';
process.env.OPENROUTER_MODEL = 'test/flash';
process.env.OPENROUTER_PRO_MODEL = 'test/pro';

const { identifyFromText } = await import('../src/llm.js');
const { metrics } = await import('../src/metrics.js');

function llmReply(items: unknown[]): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items }) } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The model the mock saw on a call — read from the request body (OpenAI shape). */
function modelOf(init?: RequestInit): string {
  try {
    return JSON.parse(String(init?.body ?? '{}')).model ?? '';
  } catch {
    return '';
  }
}

let proCalled = false;

afterEach(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  proCalled = false;
});

test('low-confidence flash result escalates to the pro model', async () => {
  const before = metrics.snapshot().escalations;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (modelOf(init) === 'test/pro') {
      proCalled = true;
      return llmReply([{ name_ru: 'борщ', name_en: 'borscht', est_grams: 300, confidence: 0.9 }]);
    }
    // flash: weak (below the 0.5 floor)
    return llmReply([{ name_ru: 'нечто', name_en: 'something', est_grams: 100, confidence: 0.3 }]);
  }) as typeof fetch;

  const items = await identifyFromText('что-то непонятное', 'RU');
  assert.equal(proCalled, true);
  assert.equal(items[0]!.name_en, 'borscht'); // the better (pro) result is kept
  assert.equal(metrics.snapshot().escalations, before + 1);
});

test('confident flash result does NOT escalate', async () => {
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (modelOf(init) === 'test/pro') {
      proCalled = true;
      return llmReply([]);
    }
    return llmReply([{ name_ru: 'банан', name_en: 'banana', est_grams: 120, confidence: 0.95 }]);
  }) as typeof fetch;

  const items = await identifyFromText('банан', 'US');
  assert.equal(proCalled, false);
  assert.equal(items[0]!.name_en, 'banana');
});
