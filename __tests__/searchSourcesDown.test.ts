import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { searchSourcesDown, setSearchSourcesDown } from '@/lib/core/services/communityBase';
import { HttpFoodParser } from '@/lib/core/services/httpFoodParser';
import { StubFoodParser } from '@/lib/core/services/stubFoodParser';

/// «Ничего не найдено» — утверждение о еде. Его можно делать, только если базу
/// реально спросили и она ответила: одного упавшего источника хватало, чтобы
/// приложение уверенно сообщило «нет в базе» о существующем продукте (репорт
/// владельца про отруби, 2026-08-22). Здесь проверяется сам различитель.

const realFetch = globalThis.fetch;

function parser(): HttpFoodParser {
  return new HttpFoodParser('https://food.test/food/parse', new StubFoodParser(), 5000);
}

beforeEach(() => setSearchSourcesDown(false));
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('searchFoods: пусто из-за отсутствия еды ≠ пусто из-за упавшего источника', () => {
  test('сервер ответил пустым списком без флага — это честное «не нашли»', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ candidates: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    expect(await parser().searchFoods('мивина', 'RU')).toEqual([]);
    expect(searchSourcesDown()).toBe(false);
  });

  test('сервер сказал sources_down — экран не имеет права говорить «нет такой еды»', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ candidates: [], sources_down: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    expect(await parser().searchFoods('мивина', 'RU')).toEqual([]);
    expect(searchSourcesDown()).toBe(true);
  });

  test('до сервера вообще не дошли — тоже не повод утверждать, что еды нет', async () => {
    globalThis.fetch = (async () => {
      throw new Error('сеть легла');
    }) as typeof fetch;

    expect(await parser().searchFoods('мивина', 'RU')).toEqual([]);
    expect(searchSourcesDown()).toBe(true);
  });

  test('удачный поиск снимает флаг — прошлый сбой не липнет к следующему запросу', async () => {
    setSearchSourcesDown(true);
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [{ name: 'Отруби овсяные', per100: { source: 'openfoodfacts', kcal: 366, prot: 17, fat: 7, carb: 66, minerals: {} } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;

    expect((await parser().searchFoods('отруби овсяные', 'RU')).length).toBe(1);
    expect(searchSourcesDown()).toBe(false);
  });
});
