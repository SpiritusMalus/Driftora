import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { OffLocalProvider } from '../src/nutrition/offLocal.js';
import { Resolver } from '../src/nutrition/resolver.js';
import { setKnownBrands, unexplainedSpecifics } from '../src/nutrition/specificity.js';
import { SkurikhinProvider } from '../src/nutrition/skurikhin.js';

/// Локальный снимок брендовой части Open Food Facts: он существует ровно
/// потому, что публичный API OFF троттлит анонимные запросы (503), а бренды
/// живут только там. Здесь проверяется, что снимок отвечает на то, на что живой
/// API отвечать отказывался.

const rows = [
  { n: 'Отруби овсяные', b: 'Мистраль', k: 369, p: 17.8, f: 6.9, c: 51.8, fi: 15.4 },
  { n: 'Творожок Простоквашино персик', k: 110, p: 7, f: 3.8, c: 12 },
  { n: 'Плавленый сыр', b: 'Хохланд', k: 283, p: 11, f: 23, c: 6.5 },
  { n: 'Молоко 3.2%', b: 'Домик в деревне', k: 60, p: 2.9, f: 3.2, c: 4.7 },
];

function providerOf(list: unknown[] = rows): OffLocalProvider {
  const dir = mkdtempSync(join(tmpdir(), 'offlocal-'));
  const path = join(dir, 'off-ru.jsonl');
  writeFileSync(path, `${list.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return OffLocalProvider.fromFile(path);
}

test('бренд из отдельного поля попадает в показываемое имя (и в индекс)', async () => {
  const off = providerOf();
  const [top] = await off.searchMany('отруби овсяные мистраль', 'RU');
  assert.equal(top?.name, 'Отруби овсяные Мистраль');
  assert.equal(top?.per100.kcal, 369);
  assert.equal(top?.per100.source, 'openfoodfacts', 'происхождение обязано оставаться честным');
});

test('бренд, уже входящий в название, не дублируется', async () => {
  const off = providerOf();
  const [top] = await off.searchMany('творожок простоквашино', 'RU');
  assert.equal(top?.name, 'Творожок Простоквашино персик');
});

test('падежи и опечатки работают, как в RU-таблице', async () => {
  const off = providerOf();
  assert.ok((await off.searchMany('отрубей овсяных мистраль', 'RU'))[0], 'падежи');
  assert.ok((await off.searchMany('сыр хохланд', 'RU'))[0], 'бренд латиницей/кириллицей');
});

test('битые строки файла пропускаются, а не роняют загрузку', () => {
  const off = providerOf(['{"сломано', ...rows, '']);
  assert.equal(off.size, rows.length);
});

test('снимок не выдаёт себя за кураторскую таблицу', async () => {
  const off = providerOf();
  for (const r of await off.searchMany('отруби овсяные мистраль', 'RU')) {
    assert.ok(r.confidence <= 0.85, `крауд-строка не может быть увереннее таблицы, было ${r.confidence}`);
  }
});

test('в цепочке снимок отвечает на брендовый запрос БЕЗ сети', async () => {
  const resolver = new Resolver([new SkurikhinProvider(), providerOf()]);
  const resolved = await resolver.resolveItem(
    { name_ru: 'сыр хохланд', name_en: 'processed cheese', est_grams: 30, confidence: 0.95 },
    'RU',
  );
  // Раньше это был «сыр российский» 410 ккал — не тот продукт и +45% калорий.
  assert.equal(resolved.matched_name, 'Плавленый сыр Хохланд');
  assert.equal(resolved.per100.kcal, 283);
  assert.ok(resolved.confidence >= 0.8, `бренд объяснён — понижать не за что, было ${resolved.confidence}`);
});

test('словарь марок ловит бренд, совпадающий с обычным словом', () => {
  // Без словаря «красная» выглядит обычным словом (есть «красная смородина»),
  // и уточнение осталось бы незамеченным.
  assert.deepEqual(unexplainedSpecifics('пельмени красная цена', 'пельмени'), ['цена']);
  try {
    setKnownBrands(['Красная цена', 'Мистраль']);
    assert.deepEqual(unexplainedSpecifics('пельмени красная цена', 'пельмени'), ['красная', 'цена']);
    // Обычная еда маркой не становится: слова из наших таблиц в словарь не берутся.
    assert.deepEqual(unexplainedSpecifics('молоко', 'молоко'), []);
  } finally {
    setKnownBrands([]); // модульное состояние — за собой убираем
  }
});

test('живой OFF по штрихкоду отдаёт ИМЯ товара, а не молчит о нём', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        status: 1,
        product: {
          product_name: 'Coca-Cola',
          product_name_ru: 'Кока-Кола',
          nutriments: { 'energy-kcal_100g': 42, proteins_100g: 0, fat_100g: 0, carbohydrates_100g: 10.6 },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;
  try {
    const { OpenFoodFactsProvider } = await import('../src/nutrition/openfoodfacts.js');
    const hit = await new OpenFoodFactsProvider().search('5449000000996', 'RU');
    // Без имени вызывающий код подставляет сам запрос — и карточка называется
    // «5449000000996». Ровно это поймал verify на проде.
    assert.equal(hit?.name, 'Кока-Кола');
    assert.equal(hit?.per100.kcal, 42);
  } finally {
    globalThis.fetch = realFetch;
  }
});
