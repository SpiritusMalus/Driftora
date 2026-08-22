import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { searchSourcesDown, setSearchSourcesDown } from '@/lib/core/services/communityBase';
import { HttpFoodParser } from '@/lib/core/services/httpFoodParser';
import { StubFoodParser } from '@/lib/core/services/stubFoodParser';

/// Путь штрихкода — единственный разбор без модели: код опознаёт товар точно,
/// поэтому это поиск по числу, а не распознавание. Здесь проверяется, что он
/// действительно ходит своим маршрутом и честно различает три вида «нет».

const realFetch = globalThis.fetch;

function parser(): HttpFoodParser {
  return new HttpFoodParser('https://food.test/food/parse', new StubFoodParser(), 5000);
}

const item = {
  name_ru: 'Бабаевский горький',
  name_en: 'Бабаевский горький',
  grams: 100,
  grams_source: 'estimated',
  confidence: 0.9,
  per100: { source: 'openfoodfacts', kcal: 540, prot: 8.5, fat: 35, carb: 42, minerals: {} },
  scaled: { kcal: 540, prot: 8.5, fat: 35, carb: 42, minerals: {} },
  approximate: true,
  matched_name: 'Бабаевский горький',
};

beforeEach(() => setSearchSourcesDown(false));
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('lookupBarcode', () => {
  test('идёт на свой маршрут /food/barcode и возвращает продукт', async () => {
    let seenUrl = '';
    let seenBody: unknown = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seenUrl = String(url);
      seenBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ item }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const found = await parser().lookupBarcode('4600823143005', 'RU');
    expect(seenUrl).toBe('https://food.test/food/barcode');
    expect(seenBody).toEqual({ code: '4600823143005', region: 'RU' });
    expect(found?.per100.kcal).toBe(540);
    // Вес не выдуман: отправная точка, помеченная как оценка — ставит человек.
    expect(found?.grams_source).toBe('estimated');
  });

  test('кода нет в базе → null, и это не считается сбоем источника', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ item: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    expect(await parser().lookupBarcode('4600823143005', 'RU')).toBeNull();
    expect(searchSourcesDown()).toBe(false);
  });

  test('база не ответила → null, но экран НЕ имеет права сказать «такого нет»', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ item: null, sources_down: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    expect(await parser().lookupBarcode('4600823143005', 'RU')).toBeNull();
    expect(searchSourcesDown()).toBe(true);
  });

  test('сети нет → null и честный признак сбоя', async () => {
    globalThis.fetch = (async () => {
      throw new Error('сеть легла');
    }) as typeof fetch;

    expect(await parser().lookupBarcode('4600823143005', 'RU')).toBeNull();
    expect(searchSourcesDown()).toBe(true);
  });

  test('офлайн-заглушка честно не знает ни одного кода', async () => {
    expect(await new StubFoodParser().lookupBarcode('4600823143005', 'RU')).toBeNull();
  });
});
