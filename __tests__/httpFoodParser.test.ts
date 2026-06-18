import { afterEach, describe, expect, it, jest } from '@jest/globals';

import type { FoodParser, MealDraft } from '@/lib/core/services/foodParser';
import { HttpFoodParser } from '@/lib/core/services/httpFoodParser';

const ENDPOINT = 'https://api.example.com/food/parse';

const SENTINEL: MealDraft = {
  region: 'US',
  items: [],
  totals: { kcal: 1, prot: 0, fat: 0, carb: 0, minerals: {} },
  portion_state: 'estimated',
  approximate: false,
  flags: { has_estimate: false, low_confidence: false },
};

class SpyFallback implements FoodParser {
  calls = 0;
  async parse(): Promise<MealDraft> {
    this.calls += 1;
    return SENTINEL;
  }
}

const VALID: MealDraft = {
  region: 'US',
  items: [
    {
      name_ru: 'Банан',
      name_en: 'banana',
      grams: 120,
      grams_source: 'estimated',
      confidence: 0.9,
      per100: { source: 'usda', kcal: 89, prot: 1.1, fat: 0.3, carb: 23, minerals: { k: 358 } },
      scaled: { kcal: 107, prot: 1.3, fat: 0.4, carb: 27.6, minerals: { k: 430 } },
      approximate: true,
    },
  ],
  totals: { kcal: 107, prot: 1.3, fat: 0.4, carb: 27.6, minerals: { k: 430 } },
  portion_state: 'estimated',
  approximate: true,
  flags: { has_estimate: false, low_confidence: false },
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
  it('returns the backend MealDraft on a valid 200 and sends text + region', async () => {
    let captured: { url: unknown; body: unknown } = { url: null, body: null };
    mockFetch(async (...args: unknown[]) => {
      captured = { url: args[0], body: JSON.parse((args[1] as { body: string }).body) };
      return { ok: true, json: async () => VALID } as unknown;
    });

    const fallback = new SpyFallback();
    const r = await new HttpFoodParser(ENDPOINT, fallback).parse('банан', 'US');

    expect(r).toEqual(VALID);
    expect(fallback.calls).toBe(0);
    expect(captured.url).toBe(ENDPOINT);
    expect(captured.body).toEqual({ text: 'банан', region: 'US' });
  });

  it('falls back when the response is not ok', async () => {
    mockFetch(async () => ({ ok: false, json: async () => ({}) }) as unknown);
    const fallback = new SpyFallback();
    const r = await new HttpFoodParser(ENDPOINT, fallback).parse('банан', 'US');
    expect(r).toBe(SENTINEL);
    expect(fallback.calls).toBe(1);
  });

  it('falls back when fetch rejects (network error)', async () => {
    mockFetch(async () => {
      throw new Error('network down');
    });
    const fallback = new SpyFallback();
    const r = await new HttpFoodParser(ENDPOINT, fallback).parse('банан', 'US');
    expect(r).toBe(SENTINEL);
    expect(fallback.calls).toBe(1);
  });

  it('falls back when the response shape is invalid', async () => {
    mockFetch(async () => ({ ok: true, json: async () => ({ items: 'nope' }) }) as unknown);
    const fallback = new SpyFallback();
    const r = await new HttpFoodParser(ENDPOINT, fallback).parse('банан', 'US');
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
    const promise = new HttpFoodParser(ENDPOINT, fallback, 50).parse('банан', 'US');
    await jest.advanceTimersByTimeAsync(60);
    const r = await promise;
    expect(r).toBe(SENTINEL);
    expect(fallback.calls).toBe(1);
  });
});
