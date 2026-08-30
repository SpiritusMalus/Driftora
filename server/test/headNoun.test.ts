import assert from 'node:assert/strict';
import { test } from 'node:test';

import { headNounLost } from '../src/nutrition/scoring.js';
import { Resolver } from '../src/nutrition/resolver.js';
import type { NutritionProvider } from '../src/nutrition/provider.js';

test('английская пара: подмена происходит именно здесь', () => {
  // Провайдеров спрашивают по name_en, покрытие считают по английской паре, а
  // русское имя в ответе — уже перевод для показа.
  assert.equal(headNounLost('cereal bun', 'cereal'), true, '«злаковая булочка» → «Хлопья»');
  assert.equal(headNounLost('chicken breast', 'chicken'), true, 'целая курица вместо грудки — другая еда');
  assert.equal(headNounLost('soba noodles', 'buckwheat groats'), false);
  // Три слова и больше — не трогаем: хвостом там часто стоит БРЕНД, и
  // требование покрыть его отвергало бы честную «Oat Bran» ради брендовой.
  assert.equal(headNounLost('oat bran mistral', 'oat bran'), false);
  // ГРАНИЦА ПРАВИЛА, записана намеренно. «гречневая лапша» → «гречка варёная»
  // (usda 92, отчёт 2026-08-30) им НЕ ловится: там не совпало и определение —
  // «soba» с «buckwheat» не пересекается ни одной буквой, подмена пришла из
  // самого поиска провайдера, а не из нашего гейта покрытия. Правило чинит
  // класс «совпал модификатор», а не всякую чужую строку.
  assert.equal(headNounLost('chicken breast', 'chicken breast raw'), false, 'главное слово на месте');
  assert.equal(headNounLost('greek yogurt', 'yogurt plain'), false, 'отпало уточнение — еда та же');
});

test('подмена: совпало определение, главное слово потеряно', () => {
  // Отчёт владельца 2026-08-30: «гречневая лапша» приезжала как «гречка варёная»
  // (92 ккал) — каша вместо лапши. Покрытие 1 из 2, порог пропускает.
  assert.equal(headNounLost('овсяное печенье', 'овсянка'), true);
  assert.equal(headNounLost('гречневая каша', 'греча'), false, 'главное слово покрыто');
});

test('норма: отпало УТОЧНЕНИЕ, еда та же', () => {
  // Ровно то же покрытие (1 из 2), но уцелело главное слово — трогать нельзя.
  assert.equal(headNounLost('борщ украинский', 'борщ'), false);
  assert.equal(headNounLost('куриная грудка', 'грудка куриная'), false);
  assert.equal(headNounLost('творог обезжиренный', 'творог'), false);
});

test('правилу нечего различать — молчит', () => {
  assert.equal(headNounLost('борщ', 'борщ с мясом'), false, 'одно существительное');
  assert.equal(headNounLost('кукурузные хлопья', 'хлопья кукурузные'), false, 'главное слово покрыто');
  assert.equal(headNounLost('гречневая лапша', 'суп харчо'), false, 'не совпало вообще ничего');
});

test('короткие слова за прилагательные не принимаем', () => {
  // «щи», «уха» — существительные, но кончаются как прилагательные могли бы.
  assert.equal(headNounLost('щи зелёные', 'щи'), false);
});

// ─── и то же самое на уровне ЦЕПОЧКИ, детерминированно ───────────────────────
// Прогон через живую модель показывает баг через раз: имя блюда каждый раз
// придумывается заново. Здесь имена заданы руками — так проверяется именно
// поведение резолвера, а не удача формулировки.

function per100(kcal: number) {
  return { kcal, prot: 8, fat: 5, carb: 55 };
}

/** Источник, отвечающий одной строкой на любой запрос. */
function stub(name: string, rowName: string, kcal: number, queryLang?: 'en' | 'ru'): NutritionProvider {
  return {
    name,
    regions: ['RU', 'US'] as const,
    ...(queryLang ? { queryLang } : {}),
    async search() {
      return { name: rowName, per100: per100(kcal), confidence: 0.9 };
    },
  } as NutritionProvider;
}

test('цепочка: строка, потерявшая главное слово, не останавливает обход', async () => {
  // Первый источник отвечает «Cereal» на «cereal bun» — покрытие ровно 0.5,
  // раньше этого хватало, чтобы ОСТАНОВИТЬ цепочку: булочка приезжала
  // хлопьями (376 ккал) с правильным именем и чужими числами.
  const flakes = stub('fatsecret', 'Cereal', 376, 'en');
  const bakery = stub('skurikhin', 'булочка', 339);

  const resolved = await new Resolver([flakes, bakery]).resolveItem(
    { name_ru: 'булочка злаковая', name_en: 'cereal bun', est_grams: 60, confidence: 0.9 },
    'RU',
  );

  assert.equal(resolved.per100.kcal, 339, 'выиграть должна булочка, а не хлопья');
  assert.match(resolved.matched_name ?? '', /булоч/);
});

test('цепочка: обычное уточнение по-прежнему останавливает обход', async () => {
  // Контроль от перекоса: «борщ» на «борщ украинский» — то же покрытие 0.5,
  // но главное слово уцелело. Первый источник обязан выиграть, иначе правило
  // начнёт гонять цепочку по кругу на каждом уточнении.
  const first = stub('skurikhin', 'борщ', 49);
  const second = stub('usda', 'soup', 100, 'en');

  const resolved = await new Resolver([first, second]).resolveItem(
    { name_ru: 'борщ украинский', name_en: 'ukrainian borsch', est_grams: 300, confidence: 0.9 },
    'RU',
  );

  assert.equal(resolved.per100.kcal, 49);
});
