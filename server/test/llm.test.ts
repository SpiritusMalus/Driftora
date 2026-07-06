import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

const realFetch = globalThis.fetch;

process.env.OPENROUTER_API_KEY = 'k';
process.env.OPENROUTER_MODEL = 'test/flash';
process.env.OPENROUTER_PRO_MODEL = '';

const { identifyFromText, VisionUnavailableError } = await import('../src/llm.js');

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
