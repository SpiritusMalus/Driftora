import { afterEach, describe, expect, it, jest } from '@jest/globals';

import type { FoodParser, MealDraft, PhotoInput } from '@/lib/core/services/foodParser';
import { HttpFoodParser } from '@/lib/core/services/httpFoodParser';

const ENDPOINT = 'https://api.example.com/food/parse';
const PHOTO_ENDPOINT = 'https://api.example.com/food/parse-photo';
const PHOTO: PhotoInput = { uri: 'file:///tmp/meal.jpg', mimeType: 'image/jpeg' };

const SENTINEL: MealDraft = {
  region: 'US',
  items: [],
  totals: { kcal: 1, prot: 0, fat: 0, carb: 0, minerals: {} },
  portion_state: 'estimated',
  approximate: false,
  flags: { has_estimate: false, low_confidence: false },
};

/// Every degraded path must MARK the stub answer as an offline fallback — the
/// UI says so instead of passing stub numbers off as an AI parse.
const OFFLINE_SENTINEL: MealDraft = {
  ...SENTINEL,
  flags: { ...SENTINEL.flags, offline_fallback: true },
};

class SpyFallback implements FoodParser {
  calls = 0;
  photoCalls = 0;
  audioCalls = 0;
  async parse(): Promise<MealDraft> {
    this.calls += 1;
    return SENTINEL;
  }
  async parsePhoto(): Promise<MealDraft> {
    this.photoCalls += 1;
    return SENTINEL;
  }
  async parseAudio(): Promise<MealDraft> {
    this.audioCalls += 1;
    return SENTINEL;
  }
  searchCalls = 0;
  async searchFoods() {
    this.searchCalls += 1;
    return [];
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

  it('falls back when the response is not ok — flagged as offline', async () => {
    mockFetch(async () => ({ ok: false, json: async () => ({}) }) as unknown);
    const fallback = new SpyFallback();
    const r = await new HttpFoodParser(ENDPOINT, fallback).parse('банан', 'US');
    expect(r).toEqual(OFFLINE_SENTINEL);
    expect(fallback.calls).toBe(1);
  });

  it('falls back when fetch rejects (network error) — flagged as offline', async () => {
    mockFetch(async () => {
      throw new Error('network down');
    });
    const fallback = new SpyFallback();
    const r = await new HttpFoodParser(ENDPOINT, fallback).parse('банан', 'US');
    expect(r).toEqual(OFFLINE_SENTINEL);
    expect(fallback.calls).toBe(1);
  });

  it('falls back when the response shape is invalid — flagged as offline', async () => {
    mockFetch(async () => ({ ok: true, json: async () => ({ items: 'nope' }) }) as unknown);
    const fallback = new SpyFallback();
    const r = await new HttpFoodParser(ENDPOINT, fallback).parse('банан', 'US');
    expect(r).toEqual(OFFLINE_SENTINEL);
    expect(fallback.calls).toBe(1);
  });

  it('a clean 200 carries NO offline flag', async () => {
    mockFetch(async () => ({ ok: true, json: async () => VALID }) as unknown);
    const r = await new HttpFoodParser(ENDPOINT, new SpyFallback()).parse('банан', 'US');
    expect(r.flags.offline_fallback).toBeUndefined();
  });

  it('a server `prepared` flag on an item survives validation (ready dish → no cook chips)', async () => {
    const prepared: MealDraft = {
      ...VALID,
      items: [{ ...VALID.items[0]!, name_ru: 'суп харчо', name_en: 'kharcho soup', prepared: true }],
    };
    mockFetch(async () => ({ ok: true, json: async () => prepared }) as unknown);
    const fallback = new SpyFallback();
    const r = await new HttpFoodParser(ENDPOINT, fallback).parse('суп харчо', 'RU');
    expect(fallback.calls).toBe(0);
    expect(r.items[0]?.prepared).toBe(true);
  });

  it('parsePhoto posts multipart to the derived photo endpoint and returns the draft', async () => {
    let captured: { url: unknown; isForm: boolean } = { url: null, isForm: false };
    mockFetch(async (...args: unknown[]) => {
      captured = { url: args[0], isForm: (args[1] as { body: unknown }).body instanceof FormData };
      return { ok: true, json: async () => VALID } as unknown;
    });

    const fallback = new SpyFallback();
    const r = await new HttpFoodParser(ENDPOINT, fallback).parsePhoto(PHOTO, 'US');

    expect(r).toEqual(VALID);
    expect(fallback.photoCalls).toBe(0);
    expect(captured.url).toBe(PHOTO_ENDPOINT);
    expect(captured.isForm).toBe(true);
  });

  it('parsePhoto falls back to the offline photo path on a non-2xx', async () => {
    mockFetch(async () => ({ ok: false, json: async () => ({}) }) as unknown);
    const fallback = new SpyFallback();
    const r = await new HttpFoodParser(ENDPOINT, fallback).parsePhoto(PHOTO, 'US');
    expect(r).toEqual(OFFLINE_SENTINEL);
    expect(fallback.photoCalls).toBe(1);
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
    expect(r).toEqual(OFFLINE_SENTINEL);
    expect(fallback.calls).toBe(1);
  });

  it('sends Authorization: Bearer on every route when a token is configured', async () => {
    const headers: unknown[] = [];
    mockFetch(async (...args: unknown[]) => {
      headers.push((args[1] as { headers?: Record<string, string> }).headers);
      return { ok: true, json: async () => VALID } as unknown;
    });

    const parser = new HttpFoodParser(ENDPOINT, new SpyFallback(), undefined, { token: 'app-secret' });
    await parser.parse('банан', 'US');
    await parser.parsePhoto(PHOTO, 'US');
    await parser.searchFoods('banana', 'US');

    expect(headers).toHaveLength(3);
    for (const h of headers) {
      expect((h as Record<string, string>).Authorization).toBe('Bearer app-secret');
    }
  });

  it('sends no Authorization header when no token is configured', async () => {
    const headers: unknown[] = [];
    mockFetch(async (...args: unknown[]) => {
      headers.push((args[1] as { headers?: Record<string, string> }).headers ?? {});
      return { ok: true, json: async () => VALID } as unknown;
    });

    const parser = new HttpFoodParser(ENDPOINT, new SpyFallback());
    await parser.parse('банан', 'US');
    await parser.parsePhoto(PHOTO, 'US');

    expect(headers).toHaveLength(2);
    for (const h of headers) {
      expect(h).not.toHaveProperty('Authorization');
    }
  });
});
