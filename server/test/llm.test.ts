import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

const realFetch = globalThis.fetch;

process.env.OPENROUTER_API_KEY = 'k';
process.env.OPENROUTER_MODEL = 'test/flash';
process.env.OPENROUTER_PRO_MODEL = '';

const { estimateFoodPer100, identifyFromText, VisionUnavailableError } = await import('../src/llm.js');

/// Fetch stub whose model answers the estimate-search prompt with `body`.
function stubEstimateResponse(body: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), {
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('identifyFromText: OpenRouter call carries a timeout signal', async () => {
  let seenSignal: AbortSignal | undefined;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    seenSignal = init?.signal ?? undefined;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [] }) } }] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  await identifyFromText('банан', 'US');

  assert.ok(seenSignal instanceof AbortSignal, 'expected the fetch to receive an AbortSignal');
});

test('identifyFromText: an aborted/timed-out OpenRouter call surfaces as VisionUnavailableError, not a crash', async () => {
  globalThis.fetch = (async () => {
    // Mirrors what AbortSignal.timeout() produces on expiry.
    throw new DOMException('The operation was aborted.', 'AbortError');
  }) as typeof fetch;

  await assert.rejects(() => identifyFromText('банан', 'US'), VisionUnavailableError);
});

test('estimateFoodPer100: sane numbers pass through, rounded per-100g', async () => {
  stubEstimateResponse({ name_ru: 'Творог 5%', kcal_100g: 121.4, prot_100g: 17.24, fat_100g: 5.0, carb_100g: 1.8 });

  const est = await estimateFoodPer100('творог 5%', 'RU');

  assert.ok(est);
  assert.equal(est.name, 'Творог 5%');
  assert.equal(est.kcal, 121);
  assert.equal(est.prot, 17.2);
});

test('estimateFoodPer100: absurd model numbers are rejected, same bounds as coerceEstimate', async () => {
  // A glitching (or prompt-injected) model must not hand the client a
  // «9 999 999 kcal / 100 g» card — the identify path clamps, this must too.
  stubEstimateResponse({ name_ru: 'Пудинг', kcal_100g: 9_999_999, prot_100g: 10, fat_100g: 10, carb_100g: 10 });
  assert.equal(await estimateFoodPer100('пудинг', 'RU'), null);

  stubEstimateResponse({ name_ru: 'Пудинг', kcal_100g: 200, prot_100g: 300, fat_100g: 10, carb_100g: 10 });
  assert.equal(await estimateFoodPer100('пудинг', 'RU'), null, 'macros above 100 g/100 g are impossible');

  stubEstimateResponse({ name_ru: 'Пудинг', kcal_100g: -5, prot_100g: 1, fat_100g: 1, carb_100g: 1 });
  assert.equal(await estimateFoodPer100('пудинг', 'RU'), null, 'negative numbers are impossible');
});

test('estimateFoodPer100: an all-zero estimate is dropped, not shown as an authoritative 0 kcal', async () => {
  stubEstimateResponse({ name_ru: 'Вода', kcal_100g: 0, prot_100g: 0, fat_100g: 0, carb_100g: 0 });
  assert.equal(await estimateFoodPer100('вода', 'RU'), null);
});
