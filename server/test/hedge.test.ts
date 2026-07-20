import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

const realFetch = globalThis.fetch;

process.env.OPENROUTER_API_KEY = 'k';
process.env.OPENROUTER_MODEL = 'test/flash';
process.env.OPENROUTER_PRO_MODEL = '';

const { identifyFromPhoto } = await import('../src/llm.js');

const GOOD = JSON.stringify({
  choices: [
    {
      finish_reason: 'stop',
      message: { content: JSON.stringify({ items: [{ name_ru: 'банан', name_en: 'banana', est_grams: 120, confidence: 0.9, prepared: false }] }) },
    },
  ],
});

function respond(body: string, delayMs: number): Promise<Response> {
  return new Promise((resolve) =>
    setTimeout(() => resolve(new Response(body, { headers: { 'Content-Type': 'application/json' } })), delayMs),
  );
}

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.VISION_HEDGE_MS;
});

test('hedge: a healthy fast answer never spawns a duplicate call', async () => {
  process.env.VISION_HEDGE_MS = '200';
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return respond(GOOD, 5);
  }) as typeof fetch;

  const items = await identifyFromPhoto('AAAA', 'image/jpeg', 'RU');

  assert.equal(items.length, 1);
  // Give a stray hedge timer a chance to (wrongly) fire before asserting.
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(calls, 1, 'the healthy majority must not pay the hedge tax');
});

test('hedge: when the first call stalls, the duplicate answers and wins', async () => {
  // The whole point: a looping first attempt (here: stalls 5 s) must not make
  // the user wait for its timeout — the hedge fires at 30 ms and its answer is
  // served while the stalled call is abandoned in the background.
  process.env.VISION_HEDGE_MS = '30';
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1 ? respond(GOOD, 5_000) : respond(GOOD, 10);
  }) as typeof fetch;

  const t0 = Date.now();
  const items = await identifyFromPhoto('AAAA', 'image/jpeg', 'RU');
  const elapsed = Date.now() - t0;

  assert.equal(items.length, 1);
  assert.equal(calls, 2, 'exactly one duplicate — never a storm');
  assert.ok(elapsed < 2_000, `served from the hedge lane, not the stalled one (took ${elapsed}ms)`);
});

test('hedge: VISION_HEDGE_MS=0 falls back to the sequential retry path', async () => {
  process.env.VISION_HEDGE_MS = '0';
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return respond(GOOD, 5);
  }) as typeof fetch;

  const items = await identifyFromPhoto('AAAA', 'image/jpeg', 'RU');

  assert.equal(items.length, 1);
  assert.equal(calls, 1);
});
