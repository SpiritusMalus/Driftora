import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProviderUnavailable, type NutritionProvider, type ProviderResult } from '../src/nutrition/provider.js';
import { Resolver } from '../src/nutrition/resolver.js';
import { contentTokens, translationLost, unexplainedSpecifics } from '../src/nutrition/specificity.js';
import type { IdentifiedItem, Per100, Region } from '../src/types.js';

// --- признаки по отдельности -------------------------------------------------

test('contentTokens: служебные слова не считаются', () => {
  assert.deepEqual(contentTokens('каша с молоком'), ['каша', 'молоком']);
  assert.deepEqual(contentTokens('oatmeal with milk'), ['oatmeal', 'milk']);
  assert.deepEqual(contentTokens('творог 5%'), ['творог', '5']);
});

test('translationLost: перевод выбросил бренд, обычное уточнение — нет', () => {
  // Ровно тот случай владельца: бренд не переводится, модель его роняет.
  assert.equal(translationLost('отруби овсяные мистраль', 'oat bran'), true);
  assert.equal(translationLost('лимонад тархун черноголовка', 'tarragon lemonade'), true);
  assert.equal(translationLost('молоко простоквашино 2.5%', 'milk 2.5%'), true);
  // Слово в слово — потери нет, быстрый путь сохраняется.
  assert.equal(translationLost('куриная грудка', 'chicken breast'), false);
  assert.equal(translationLost('творог 5%', 'cottage cheese 5%'), false);
  assert.equal(translationLost('протеиновый пудинг', 'protein pudding'), false);
  // Спрашивали тем же языком (или запрос вообще английский) — признак молчит.
  assert.equal(translationLost('отруби овсяные мистраль', 'отруби овсяные мистраль'), false);
  assert.equal(translationLost('oat bran mistral', 'oat bran'), false);
});

test('unexplainedSpecifics: бренд остаётся, способ приготовления и родовое слово — нет', () => {
  assert.deepEqual(unexplainedSpecifics('отруби овсяные мистраль', 'отруби овсяные'), ['мистраль']);
  assert.deepEqual(unexplainedSpecifics('лимонад тархун черноголовка', 'лимонад тархун'), ['черноголовка']);
  // «отварная» — способ приготовления: продукт тот же, цепочку не гоняем.
  assert.deepEqual(unexplainedSpecifics('куриная грудка отварная', 'куриная грудка'), []);
  // «салат» есть в наших RU-таблицах → обычное слово про еду, не уточнение.
  assert.deepEqual(unexplainedSpecifics('салат оливье', 'оливье'), []);
  assert.deepEqual(unexplainedSpecifics('борщ', 'борщ с мясом'), []);
});

// --- поведение цепочки -------------------------------------------------------

const per100 = (kcal: number, prot = 5): Per100 =>
  ({ source: 'skurikhin', kcal, prot, fat: 1, carb: 10, minerals: {} }) as Per100;

/** Провайдер-заглушка, считающий свои вызовы. */
function stub(
  name: string,
  rows: { name: string; per100: Per100; confidence: number }[],
  opts: { queryLang?: 'en' | 'ru' } = {},
): NutritionProvider & { queries: string[] } {
  const queries: string[] = [];
  return {
    name,
    regions: ['RU', 'US'] as const,
    ...(opts.queryLang ? { queryLang: opts.queryLang } : {}),
    queries,
    async search(q: string): Promise<ProviderResult | null> {
      queries.push(q);
      return rows[0] ?? null;
    },
    async searchMany(q: string, _region: Region): Promise<ProviderResult[]> {
      queries.push(q);
      return rows;
    },
  };
}

const branded = (over: Partial<IdentifiedItem> = {}): IdentifiedItem => ({
  name_ru: 'отруби овсяные мистраль',
  name_en: 'oat bran',
  est_grams: 40,
  confidence: 0.95,
  ...over,
});

test('брендовый запрос доходит до источника, где бренд ЕСТЬ (был: останавливался на generic)', async () => {
  // Порядок как в проде: RU-таблица, англоязычный источник, и только потом OFF,
  // где живут брендовые строки.
  const table = stub('table', [{ name: 'отруби овсяные', per100: per100(366, 17), confidence: 0.9 }]);
  const en = stub('en-source', [{ name: 'Oat Bran', per100: per100(246, 17), confidence: 0.95 }], { queryLang: 'en' });
  const off = stub('off', [{ name: 'Овсяные отруби Мистраль', per100: per100(407, 17.8), confidence: 0.85 }]);

  const resolved = await new Resolver([table, en, off]).resolveItem(branded(), 'RU');

  assert.equal(resolved.matched_name, 'Овсяные отруби Мистраль', 'должен победить именно брендовый продукт');
  assert.equal(resolved.per100.kcal, 407);
  assert.ok(resolved.confidence >= 0.8, `бренд объяснён — уверенность не режем, было ${resolved.confidence}`);
  // Все три источника спрошены: раньше цепочка вставала на первом же generic.
  assert.equal(off.queries.length, 1, 'до источника с брендом очередь обязана доходить');
  assert.equal(en.queries[0], 'oat bran', 'англоязычный источник по-прежнему спрашивается переводом');
});

test('бренда нет нигде → generic остаётся, но честно понижен и с ИИ-оценкой в вариантах', async () => {
  const table = stub('table', [{ name: 'отруби овсяные', per100: per100(366, 17), confidence: 0.9 }]);
  const en = stub('en-source', [{ name: 'Oat Bran', per100: per100(246, 17), confidence: 0.95 }], { queryLang: 'en' });

  const estimator = async (name: string) => ({ name, kcal: 380, prot: 17, fat: 7, carb: 66 });
  const resolved = await new Resolver([table, en], estimator).resolveItem(branded(), 'RU');

  assert.equal(resolved.per100.kcal, 366, 'реальная строка про тот же продукт остаётся основной');
  assert.ok(resolved.confidence <= 0.3, `неподтверждённый бренд обязан открывать пикер, было ${resolved.confidence}`);
  assert.ok(
    (resolved.alternatives ?? []).some((a) => a.per100.source === 'ai_estimate'),
    'рядом должна лежать честная ИИ-оценка именно того, что человек написал',
  );
});

test('обычный запрос не платит ни латентностью, ни уверенностью', async () => {
  const table = stub('table', [{ name: 'куриная грудка', per100: per100(165, 31), confidence: 0.95 }]);
  const off = stub('off', [{ name: 'Грудка куриная Мираторг', per100: per100(120, 20), confidence: 0.85 }]);

  const resolved = await new Resolver([table, off]).resolveItem(
    { name_ru: 'куриная грудка', name_en: 'chicken breast', est_grams: 150, confidence: 0.9 },
    'RU',
  );

  assert.equal(resolved.per100.kcal, 165);
  assert.ok(resolved.confidence >= 0.9);
  assert.equal(off.queries.length, 0, 'полностью объяснённый запрос обязан останавливать цепочку на первом источнике');
});

test('способ приготовления не считается брендом (иначе цепочка бегала бы всегда)', async () => {
  const table = stub('table', [{ name: 'куриная грудка', per100: per100(165, 31), confidence: 0.95 }]);
  const off = stub('off', [{ name: 'что угодно', per100: per100(1), confidence: 0.8 }]);

  const resolved = await new Resolver([table, off]).resolveItem(
    { name_ru: 'куриная грудка отварная', name_en: 'boiled chicken breast', est_grams: 150, confidence: 0.9 },
    'RU',
  );

  assert.equal(resolved.per100.kcal, 165);
  assert.ok(resolved.confidence >= 0.9, `было ${resolved.confidence}`);
  assert.equal(off.queries.length, 0);
});

test('английский запрос (US) механизм не трогает', async () => {
  const usda = stub('usda', [{ name: 'Oat Bran', per100: per100(246, 17), confidence: 0.95 }], { queryLang: 'en' });
  const off = stub('off', [{ name: 'Mistral Oat Bran', per100: per100(407), confidence: 0.85 }]);

  const resolved = await new Resolver([usda, off]).resolveItem(
    { name_ru: 'овсяные отруби', name_en: 'oat bran mistral', est_grams: 40, confidence: 0.9 },
    'US',
  );

  // US спрашивает name_en напрямую — покрытие меряется в одном языке, как и было.
  assert.equal(resolved.per100.kcal, 246);
});

test('ответ, собранный при упавшем источнике, НЕ кешируется', async () => {
  const table = stub('table', [{ name: 'отруби овсяные', per100: per100(366, 17), confidence: 0.9 }]);
  // Источник с брендом ложится на первый запрос и оживает на второй — ровно то,
  // что делает Open Food Facts под троттлингом (503 в 2 попытках из 3).
  let attempt = 0;
  const flaky: NutritionProvider = {
    name: 'off',
    regions: ['RU', 'US'] as const,
    async search() {
      return null;
    },
    async searchMany(): Promise<ProviderResult[]> {
      attempt += 1;
      if (attempt === 1) throw new ProviderUnavailable('off');
      return [{ name: 'Овсяные отруби Мистраль', per100: per100(407, 17.8), confidence: 0.85 }];
    },
  };

  const resolver = new Resolver([table, flaky]);
  const first = await resolver.resolveItem(branded(), 'RU');
  assert.equal(first.per100.kcal, 366, 'во время сбоя — честная родовая строка');
  assert.ok(first.confidence <= 0.3);

  // Второй разбор той же еды обязан спросить заново, а не выдать замороженный
  // плохой ответ: иначе одна минута троттлинга держится до перезапуска сервера.
  const second = await resolver.resolveItem(branded(), 'RU');
  assert.equal(second.matched_name, 'Овсяные отруби Мистраль');
  assert.equal(second.per100.kcal, 407);
});

// --- аудит 2026-08-26: лингвистика перевода и голые числа --------------------

test('translationLost: обычная еда, чьи два русских слова = одно английское, НЕ флажится', () => {
  // «Сжатие» перевода — норма языка, не потерянный бренд: до фикса любой такой
  // продукт мимо RU-таблиц демотировал чистый хит USDA/FatSecret до 0.3.
  assert.equal(translationLost('грецкий орех', 'walnuts'), false);
  assert.equal(translationLost('морская капуста', 'seaweed'), false);
  assert.equal(translationLost('цветная капуста', 'cauliflower'), false);
  // А бренд рядом с теми же словами — флажится по-прежнему.
  assert.equal(translationLost('морская капуста мистраль', 'seaweed'), true);
});

test('unexplainedSpecifics: числа — не «уточнение по существу», сорта ведёт резолвер', () => {
  // «7» само по себе не делает хлеб другим продуктом; вариант по существу
  // ведёт слово «злаков» (его нет в таблицах) — и только оно.
  assert.deepEqual(unexplainedSpecifics('хлеб 7 злаков', 'хлеб зерновой'), ['злаков']);
  // Жирность тоже: normalizeName растворяет «3.2» в «3 2», по голым целым сорт
  // не отличить от счёта штук — настоящий сорт ловит gradesOf резолвера по
  // сырому имени (закреплено тестом «молоко 1.8%» в resolver.test.ts).
  assert.deepEqual(unexplainedSpecifics('молоко 3.2', 'молоко'), []);
});
