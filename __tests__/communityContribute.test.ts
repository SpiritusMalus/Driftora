import { afterEach, describe, expect, it, jest } from '@jest/globals';

import type { NutritionAlternative } from '@/lib/core/services/foodParser';
import { HttpFoodParser } from '@/lib/core/services/httpFoodParser';
import { StubFoodParser } from '@/lib/core/services/stubFoodParser';

/**
 * WHAT ACTUALLY GOES ON THE WIRE when a food is offered to the shared base.
 *
 * `communityShare.test.ts` guards which foods qualify; this guards the request
 * itself — the same minimization contract `foodRequestMinimization.test.ts`
 * holds the parse routes to, asserted directly off the outgoing body. The base
 * is public, so the promise «уходит только название и КБЖУ» has to be checkable
 * and not merely written down.
 */

const ENDPOINT = 'https://api.example.com/food/parse';
const realFetch = global.fetch;

function food(): NutritionAlternative {
  return {
    name: 'Шаурма с курицей',
    per100: {
      source: 'manual',
      kcal: 215,
      prot: 12,
      fat: 11,
      carb: 16,
      fiber: 1.4,
      minerals: { na: 480, k: 210 },
      vitamins: { c: 3 },
    },
  };
}

function mockFetch(impl: (...a: unknown[]) => Promise<unknown>): void {
  global.fetch = jest.fn(impl) as unknown as typeof fetch;
}

/** Capture one outgoing request. */
async function send(food: NutritionAlternative, region: 'RU' | 'US' = 'RU') {
  let url = '';
  let init: { body: string; headers: Record<string, string> } = { body: '{}', headers: {} };
  mockFetch(async (...args: unknown[]) => {
    url = args[0] as string;
    init = args[1] as { body: string; headers: Record<string, string> };
    return { ok: true, json: async () => ({ ok: true, votes: 1 }) } as unknown;
  });
  await new HttpFoodParser(ENDPOINT, new StubFoodParser(), undefined, {
    token: 'app-token',
    installId: () => 'deadbeefdeadbeefdeadbeefdeadbeef',
  }).contributeFood(food, region);
  return { url, body: JSON.parse(init.body) as Record<string, unknown>, headers: init.headers };
}

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('contributing a food to the shared base', () => {
  it('POSTs to the derived /food/contribute endpoint', async () => {
    const { url } = await send(food());
    expect(url).toBe('https://api.example.com/food/contribute');
  });

  it('sends the name, the region and the per-100 g macros — and nothing else', async () => {
    const { body } = await send(food());
    expect(body).toEqual({
      name: 'Шаурма с курицей',
      region: 'RU',
      // Macros only: the base stores no micronutrients (nobody reads iron off a
      // shawarma), so sending them would widen what leaves the phone for data
      // that is discarded on arrival.
      per100: { kcal: 215, prot: 12, fat: 11, carb: 16, fiber: 1.4 },
    });
  });

  it('never carries the install id — a row in the base is a food, not a person', async () => {
    // Every AI route sends X-Install-Id so the server can meter its quota. This
    // route deliberately does not: the quota is not what bounds it (the per-IP
    // daily cap is), and an id next to a food is exactly the link the base
    // promises does not exist.
    const { headers } = await send(food());
    expect(headers['X-Install-Id']).toBeUndefined();
    expect(headers.Authorization).toBe('Bearer app-token');
  });

  it('omits an optional field the local row does not have', async () => {
    const bare = food();
    delete bare.per100.fiber;
    const { body } = await send(bare);
    expect(body.per100).toEqual({ kcal: 215, prot: 12, fat: 11, carb: 16 });
  });

  it('carries the region, so RU dishes never surface for US users', async () => {
    const { body } = await send(food(), 'US');
    expect(body.region).toBe('US');
  });
});

describe('a failed donation is never the user’s problem', () => {
  it('resolves on a server refusal', async () => {
    mockFetch(async () => ({ ok: false, json: async () => ({}) }) as unknown);
    await expect(
      new HttpFoodParser(ENDPOINT, new StubFoodParser()).contributeFood(food(), 'RU'),
    ).resolves.toBeUndefined();
  });

  it('resolves when the device is offline', async () => {
    mockFetch(async () => {
      throw new Error('network down');
    });
    await expect(
      new HttpFoodParser(ENDPOINT, new StubFoodParser()).contributeFood(food(), 'RU'),
    ).resolves.toBeUndefined();
  });

  it('sends nothing at all from the offline parser', async () => {
    // This is the parser the app holds whenever AI consent is absent, which is
    // what makes "no consent ⇒ nothing leaves" a guarantee and not a policy.
    const spy = jest.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown);
    mockFetch(spy);
    await new StubFoodParser().contributeFood();
    expect(spy).not.toHaveBeenCalled();
  });
});
