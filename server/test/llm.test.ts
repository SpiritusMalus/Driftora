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

// ---- truncation guard (max_tokens / degenerate decode loop) -----------------

/**
 * Fetch stub replaying a scripted sequence of responses, one per call, so a
 * test can express "truncated first, good on the retry". Records the outgoing
 * temperature of every call.
 */
function stubSequence(responses: { content: string; finish: string }[]): { calls: number[] } {
  const temps: number[] = [];
  let i = 0;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    temps.push(JSON.parse(String(init?.body ?? '{}')).temperature);
    const r = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return new Response(
      JSON.stringify({ choices: [{ finish_reason: r.finish, message: { content: r.content } }] }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;
  return { calls: temps };
}

const TRUNCATED = { content: '{"items":[{"name_ru":"запеченная инде', finish: 'length' };

test('identify: a truncated answer is retried once at a non-zero temperature', async () => {
  const seen = stubSequence([
    TRUNCATED,
    { content: JSON.stringify({ items: [{ name_ru: 'банан', name_en: 'banana', est_grams: 120, confidence: 0.9 }] }), finish: 'stop' },
  ]);

  const items = await identifyFromText('банан', 'RU');

  assert.equal(seen.calls.length, 2, 'expected exactly one retry');
  assert.equal(seen.calls[0], 0, 'first attempt stays greedy');
  assert.ok((seen.calls[1] ?? 0) > 0, 'the retry must re-roll at a different temperature');
  assert.equal(items.length, 1, 'the retry result is what the caller gets');
  assert.equal(items[0]?.name_ru, 'банан');
});

test('identify: a still-truncated retry fails loudly — never a silent «не распознал»', async () => {
  // The 1024-token ceiling shipped this exact shape for weeks: the model burned
  // its budget on reasoning, the JSON never closed, and the empty list rendered
  // as "no food found". A server-side truncation must surface as an error.
  const seen = stubSequence([TRUNCATED, TRUNCATED]);

  await assert.rejects(() => identifyFromText('банан', 'RU'), VisionUnavailableError);
  assert.equal(seen.calls.length, 2, 'retried once, then gave up — no retry storm');
});

test('identify: an HONEST empty result is still empty, not an error', async () => {
  // Regression guard for the fix above: "this photo has no food in it" is a
  // legitimate answer and must not be turned into a 503.
  const seen = stubSequence([{ content: JSON.stringify({ items: [] }), finish: 'stop' }]);

  assert.deepEqual(await identifyFromText('стол', 'RU'), []);
  assert.equal(seen.calls.length, 1, 'a complete answer is never retried');
});

test('identify: a provider error riding on HTTP 200 fails loudly, and is not retried', async () => {
  // OpenRouter reports an upstream rate limit / outage INSIDE a 200 response:
  // finish_reason 'error' + a null content. Parsed naively that is an empty
  // item list — i.e. «не распознал» for what is really "try again in a moment".
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        choices: [
          { finish_reason: 'error', error: { code: 429, message: 'rate limit' }, message: { content: null } },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  await assert.rejects(() => identifyFromText('банан', 'RU'), VisionUnavailableError);
  assert.equal(calls, 1, 'a refusing provider must not be hammered with a retry');
});

test('identify: a body that cannot be read is a failure, not an empty plate', async () => {
  // The timeout fires while the BODY is being read (fetch already resolved on
  // headers), so the abort surfaces on res.json(). Swallowing it produced a
  // silent «не распознал» on an HTTP 200 — the hardest strain to spot, because
  // it is indistinguishable from an honest "no food here".
  globalThis.fetch = (async () =>
    new Response('{"choices":[{"message":{"content":"{\\"items\\"', {
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

  await assert.rejects(() => identifyFromText('банан', 'RU'), VisionUnavailableError);
});
