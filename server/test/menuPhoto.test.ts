import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

const realFetch = globalThis.fetch;

process.env.OPENROUTER_API_KEY = 'k';
process.env.OPENROUTER_MODEL = 'test/flash';
process.env.OPENROUTER_PRO_MODEL = '';

const { identifyFromPhoto } = await import('../src/llm.js');

/// Снимок строки меню: еды перед камерой нет, есть печатное описание блюда.
const MENU = JSON.stringify({
  choices: [
    {
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          items: [],
          menu_text:
            'Сэндвич «Вега»: злаковая булочка со сливочным сыром, салатом, помидорами, свежим огурцом и соусом бальзамик',
        }),
      },
    },
  ],
});

/// И меню, и настоящая тарелка в кадре: промпт говорит «еда побеждает».
const BOTH = JSON.stringify({
  choices: [
    {
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          items: [{ name_ru: 'банан', name_en: 'banana', est_grams: 120, confidence: 0.9, prepared: false }],
          menu_text: 'Сэндвич «Вега»',
        }),
      },
    },
  ],
});

function json(body: string): Promise<Response> {
  return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'application/json' } }));
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('фото меню отдаёт описание блюда, а не пустоту', async () => {
  globalThis.fetch = (async () => json(MENU)) as typeof fetch;

  const { items, menuText } = await identifyFromPhoto('AAAA', 'image/jpeg', 'RU');

  assert.equal(items.length, 0, 'еды в кадре нет — выдумывать её нельзя');
  assert.match(menuText, /Сэндвич «Вега»/);
  assert.match(menuText, /бальзамик/, 'состав нужен целиком: он точнее, чем набрал бы человек');
});

test('когда в кадре и еда, и меню — выигрывает еда', async () => {
  globalThis.fetch = (async () => json(BOTH)) as typeof fetch;

  const { items, menuText } = await identifyFromPhoto('AAAA', 'image/jpeg', 'RU');

  assert.equal(items.length, 1);
  assert.equal(menuText, '', 'иначе приложение разберёт меню вместо тарелки перед человеком');
});

const wholeFish = { name_ru: 'рыба на гриле', name_en: 'grilled whole fish', est_grams: 220,
  confidence: 0.9, prepared: false, weight_basis: 'as_eaten' };

function completion(content: object): Promise<Response> {
  return json(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }));
}

test('generic cooked fish gets a focused check without changing its portion or side dishes', async () => {
  let calls = 0;
  const side = { ...wholeFish, name_ru: 'овощной салат', name_en: 'vegetable salad', est_grams: 150 };
  globalThis.fetch = async () => ++calls === 1
    ? completion({ items: [wholeFish, side] }) : completion({ species: 'trout' });

  const { items } = await identifyFromPhoto('AAAA', 'image/jpeg', 'RU');
  assert.equal(calls, 2);
  assert.deepEqual(items.map(({ name_ru, name_en, est_grams }) => [name_ru, name_en, est_grams]), [
    ['форель на гриле', 'grilled trout', 220], ['овощной салат', 'vegetable salad', 150],
  ]);
});

test('a weak or unavailable species check keeps the generic photo result', async () => {
  for (const fail of [false, true]) {
    let calls = 0;
    globalThis.fetch = async () => {
      if (++calls === 1) return completion({ items: [wholeFish] });
      if (fail) throw new Error('offline');
      return completion({ species: 'unknown' });
    };
    const { items } = await identifyFromPhoto('AAAA', 'image/jpeg', 'RU');
    assert.equal(calls, 2);
    assert.equal(items[0]?.name_ru, wholeFish.name_ru);
  }
});

test('an already named species or a packaged item does not incur a second vision call', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    ++calls;
    return completion({ items: [
      { ...wholeFish, name_ru: 'форель на гриле', name_en: 'grilled trout' },
      { ...wholeFish, packaged: true },
    ] });
  };
  const { items } = await identifyFromPhoto('AAAA', 'image/jpeg', 'RU');
  assert.equal(calls, 1);
  assert.equal(items[0]?.name_ru, 'форель на гриле');
});

test('photo identification keeps the serving and excludes incidental foods regardless of their name', async () => {
  const food = (name_ru: string, name_en: string, photo_scope: string) => ({
    ...wholeFish, name_ru, name_en, photo_scope,
  });
  globalThis.fetch = async () => completion({ items: [
    food('ломтик хлеба', 'slice of bread', 'serving'),
    food('сыр', 'cheese', 'background'),
    food('томатный суп', 'tomato soup', 'serving'),
    food('лимон', 'lemon', 'background'),
  ] });
  const { items } = await identifyFromPhoto('AAAA', 'image/jpeg', 'RU');
  assert.deepEqual(items.map(({ name_en }) => name_en), ['slice of bread', 'tomato soup']);
});
