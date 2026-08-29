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
