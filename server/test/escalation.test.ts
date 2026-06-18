import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

const realFetch = globalThis.fetch;

process.env.GEMINI_API_KEY = 'k';
process.env.GEMINI_MODEL = 'gemini-3-flash';
process.env.GEMINI_PRO_MODEL = 'gemini-3-pro';

const { identifyFromText } = await import('../src/gemini.js');
const { metrics } = await import('../src/metrics.js');

function geminiReply(items: unknown[]): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items }) }] } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
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
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('gemini-3-pro')) {
      proCalled = true;
      return geminiReply([{ name_ru: 'борщ', name_en: 'borscht', est_grams: 300, confidence: 0.9 }]);
    }
    // flash: weak (below the 0.5 floor)
    return geminiReply([{ name_ru: 'нечто', name_en: 'something', est_grams: 100, confidence: 0.3 }]);
  }) as typeof fetch;

  const items = await identifyFromText('что-то непонятное', 'RU');
  assert.equal(proCalled, true);
  assert.equal(items[0]!.name_en, 'borscht'); // the better (pro) result is kept
  assert.equal(metrics.snapshot().escalations, before + 1);
});

test('confident flash result does NOT escalate', async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('gemini-3-pro')) {
      proCalled = true;
      return geminiReply([]);
    }
    return geminiReply([{ name_ru: 'банан', name_en: 'banana', est_grams: 120, confidence: 0.95 }]);
  }) as typeof fetch;

  const items = await identifyFromText('банан', 'US');
  assert.equal(proCalled, false);
  assert.equal(items[0]!.name_en, 'banana');
});
