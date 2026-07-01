import { afterEach, describe, expect, it, jest } from '@jest/globals';

import type { NutritionAlternative } from '@/lib/core/services/foodParser';
import { HttpFoodParser } from '@/lib/core/services/httpFoodParser';
import { StubFoodParser } from '@/lib/core/services/stubFoodParser';

const ENDPOINT = 'https://api.example.com/food/parse';
const realFetch = global.fetch;

function alt(name: string, kcal: number): NutritionAlternative {
  return { name, per100: { source: 'fatsecret', kcal, prot: 1, fat: 1, carb: 1, minerals: {} } };
}

function mockFetch(impl: () => Promise<unknown>): void {
  global.fetch = jest.fn(impl) as unknown as typeof fetch;
}

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('HttpFoodParser.searchFoods', () => {
  it('POSTs the query to the derived /food/search endpoint and returns candidates', async () => {
    let url = '';
    let body: Record<string, unknown> = {};
    mockFetch(async (...args: unknown[]) => {
      url = args[0] as string;
      body = JSON.parse((args[1] as { body: string }).body);
      return { ok: true, json: async () => ({ candidates: [alt('Творог', 121), alt('Творог 9%', 159)] }) } as unknown;
    });

    const parser = new HttpFoodParser(ENDPOINT, new StubFoodParser());
    const out = await parser.searchFoods('творог', 'RU');

    expect(url).toBe('https://api.example.com/food/search');
    expect(body).toEqual({ query: 'творог', region: 'RU' });
    expect(out.map((a) => a.per100.kcal)).toEqual([121, 159]);
  });

  it('falls back to the offline stub (empty) on a non-2xx', async () => {
    mockFetch(async () => ({ ok: false, json: async () => ({}) }) as unknown);
    const out = await new HttpFoodParser(ENDPOINT, new StubFoodParser()).searchFoods('rice', 'US');
    expect(out).toEqual([]);
  });

  it('drops malformed candidates that fail the structural guard', async () => {
    mockFetch(
      async () =>
        ({
          ok: true,
          json: async () => ({ candidates: [alt('ok', 100), { name: 'bad' /* no per100 */ }, 42] }),
        }) as unknown,
    );
    const out = await new HttpFoodParser(ENDPOINT, new StubFoodParser()).searchFoods('x', 'US');
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('ok');
  });

  it('returns [] for an empty query without hitting the network', async () => {
    const spy = jest.fn(async () => ({ ok: true, json: async () => ({ candidates: [] }) }) as unknown);
    global.fetch = spy as unknown as typeof fetch;
    const out = await new HttpFoodParser(ENDPOINT, new StubFoodParser()).searchFoods('   ', 'US');
    expect(out).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('StubFoodParser.searchFoods', () => {
  it('returns nothing offline (no on-device nutrition DB)', async () => {
    expect(await new StubFoodParser().searchFoods('творог', 'RU')).toEqual([]);
  });
});
