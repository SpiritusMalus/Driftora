import { afterEach, describe, expect, it, jest } from '@jest/globals';

import type { FoodParseResult, FoodParser } from '@/lib/core/services/foodParser';
import { HttpFoodParser } from '@/lib/core/services/httpFoodParser';

const ENDPOINT = 'https://api.example.com/food/parse';

const SENTINEL: FoodParseResult = {
  items: [{ name: 'офлайн', qtyG: null, kcal: 1, proteinG: 0, fatG: 0, carbG: 0, assumptions: 'stub' }],
  kcal: 1,
  proteinG: 0,
  fatG: 0,
  carbG: 0,
  confidence: 'low',
  needsClarification: false,
  clarifyQuestion: null,
};

class SpyFallback implements FoodParser {
  calls = 0;
  async parse(): Promise<FoodParseResult> {
    this.calls += 1;
    return SENTINEL;
  }
}

const VALID: FoodParseResult = {
  items: [{ name: 'Банан', qtyG: 120, kcal: 105, proteinG: 1.3, fatG: 0.4, carbG: 27, assumptions: '' }],
  kcal: 105,
  proteinG: 1.3,
  fatG: 0.4,
  carbG: 27,
  confidence: 'high',
  needsClarification: false,
  clarifyQuestion: null,
};

function mockFetch(impl: () => Promise<unknown>): void {
  // @ts-expect-error — install a fetch stub for the test environment
  global.fetch = jest.fn(impl);
}

afterEach(() => {
  // @ts-expect-error — clean up the stub
  delete global.fetch;
  jest.useRealTimers();
});

describe('HttpFoodParser', () => {
  it('returns the backend result on a valid 200 and sends utterance + locale', async () => {
    let captured: { url: unknown; body: unknown } = { url: null, body: null };
    mockFetch(async (...args: unknown[]) => {
      captured = { url: args[0], body: JSON.parse((args[1] as { body: string }).body) };
      return { ok: true, json: async () => VALID } as unknown;
    });

    const fallback = new SpyFallback();
    const r = await new HttpFoodParser(ENDPOINT, fallback).parse('банан');

    expect(r).toEqual(VALID);
    expect(fallback.calls).toBe(0);
    expect(captured.url).toBe(ENDPOINT);
    expect(captured.body).toEqual({ utterance: 'банан', locale: 'ru' });
  });

  it('falls back when the response is not ok', async () => {
    mockFetch(async () => ({ ok: false, json: async () => ({}) }) as unknown);
    const fallback = new SpyFallback();
    const r = await new HttpFoodParser(ENDPOINT, fallback).parse('банан');
    expect(r).toBe(SENTINEL);
    expect(fallback.calls).toBe(1);
  });

  it('falls back when fetch rejects (network error)', async () => {
    mockFetch(async () => {
      throw new Error('network down');
    });
    const fallback = new SpyFallback();
    const r = await new HttpFoodParser(ENDPOINT, fallback).parse('банан');
    expect(r).toBe(SENTINEL);
    expect(fallback.calls).toBe(1);
  });

  it('falls back when the response shape is invalid', async () => {
    mockFetch(async () => ({ ok: true, json: async () => ({ items: 'nope' }) }) as unknown);
    const fallback = new SpyFallback();
    const r = await new HttpFoodParser(ENDPOINT, fallback).parse('банан');
    expect(r).toBe(SENTINEL);
    expect(fallback.calls).toBe(1);
  });

  it('aborts on timeout and falls back', async () => {
    jest.useFakeTimers();
    mockFetch(
      (...args: unknown[]) =>
        new Promise((_resolve, reject) => {
          const signal = (args[1] as { signal: AbortSignal }).signal;
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const fallback = new SpyFallback();
    const promise = new HttpFoodParser(ENDPOINT, fallback, 50).parse('банан');
    await jest.advanceTimersByTimeAsync(60);
    const r = await promise;
    expect(r).toBe(SENTINEL);
    expect(fallback.calls).toBe(1);
  });
});
