import { afterEach, describe, expect, it, jest } from '@jest/globals';

import type { AudioInput, MealDraft, PhotoInput } from '@/lib/core/services/foodParser';
import { HttpFoodParser } from '@/lib/core/services/httpFoodParser';

const ENDPOINT = 'https://api.example.com/food/parse';
const PHOTO: PhotoInput = { uri: 'file:///tmp/meal.jpg', mimeType: 'image/jpeg' };
const AUDIO: AudioInput = { uri: 'file:///tmp/meal.m4a', mimeType: 'audio/m4a' };

const VALID: MealDraft = {
  region: 'US',
  items: [],
  totals: { kcal: 0, prot: 0, fat: 0, carb: 0, minerals: {} },
  portion_state: 'estimated',
  approximate: false,
  flags: { has_estimate: false, low_confidence: false },
};

// A no-op fallback — these tests only inspect the request, never the fallback.
const noopFallback = {
  parse: async () => VALID,
  parsePhoto: async () => VALID,
  parseAudio: async () => VALID,
  searchFoods: async () => [],
};

function mockFetch(impl: (...a: unknown[]) => Promise<unknown>): void {
  // @ts-expect-error — install a fetch stub for the test environment
  global.fetch = jest.fn(impl);
}

afterEach(() => {
  // @ts-expect-error — clean up the stub
  delete global.fetch;
});

/// HARD INVARIANT (TASK Don'ts / §B): the food-parse request body carries ONLY
/// the meal text (or image) + region — NEVER diary/mood/weight or any user id.
/// Consent makes the transfer lawful; minimization caps the leak. This asserts
/// the wire shape directly off the outgoing request.

const FORBIDDEN = ['diary', 'mood', 'weight', 'userId', 'user_id', 'id', 'token'];

describe('food-parse request minimization', () => {
  it('text parse sends exactly { text, region } and nothing else', async () => {
    let body: Record<string, unknown> = {};
    mockFetch(async (...args: unknown[]) => {
      body = JSON.parse((args[1] as { body: string }).body);
      return { ok: true, json: async () => VALID } as unknown;
    });

    await new HttpFoodParser(ENDPOINT, noopFallback).parse('омлет из трёх яиц', 'RU');

    expect(Object.keys(body).sort()).toEqual(['region', 'text']);
    expect(body).toEqual({ text: 'омлет из трёх яиц', region: 'RU' });
    for (const key of FORBIDDEN) expect(body).not.toHaveProperty(key);
  });

  it('photo parse sends only the image + region form fields, no user data', async () => {
    let form: FormData | null = null;
    mockFetch(async (...args: unknown[]) => {
      form = (args[1] as { body: FormData }).body;
      return { ok: true, json: async () => VALID } as unknown;
    });

    await new HttpFoodParser(ENDPOINT, noopFallback).parsePhoto(PHOTO, 'US');

    expect(form).toBeInstanceOf(FormData);
    const keys = [...(form as unknown as FormData).keys()].sort();
    expect(keys).toEqual(['image', 'region']);
    for (const key of FORBIDDEN) {
      expect((form as unknown as FormData).has(key)).toBe(false);
    }
  });

  it('voice parse sends only the audio + region form fields, no user data', async () => {
    let form: FormData | null = null;
    mockFetch(async (...args: unknown[]) => {
      form = (args[1] as { body: FormData }).body;
      return { ok: true, json: async () => VALID } as unknown;
    });

    await new HttpFoodParser(ENDPOINT, noopFallback).parseAudio(AUDIO, 'US');

    expect(form).toBeInstanceOf(FormData);
    const keys = [...(form as unknown as FormData).keys()].sort();
    expect(keys).toEqual(['audio', 'region']);
    for (const key of FORBIDDEN) {
      expect((form as unknown as FormData).has(key)).toBe(false);
    }
  });
});
