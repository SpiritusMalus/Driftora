import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { NutritionProvider, ProviderResult } from '../src/nutrition/provider.js';
import { Resolver } from '../src/nutrition/resolver.js';
import type { IdentifiedItem, Per100 } from '../src/types.js';

/**
 * БАЗИС — СВОЙСТВО ПАРЫ (вес, строка). Регресс на ОБА направления одной и той
 * же ошибки: одна вода, посчитанная не в ту сторону, и втрое неверный итог.
 */

function per100(kcal: number, over: Partial<Per100> = {}): Per100 {
  return { source: 'skurikhin', kcal, prot: 4, fat: 6, carb: 16, minerals: {}, ...over };
}

function provider(results: ProviderResult[]): NutritionProvider {
  return {
    name: 'fake',
    regions: ['US', 'RU'],
    async search(_n, _r) {
      return results[0] ?? null;
    },
    async searchMany(_n, _r) {
      return results;
    },
  };
}

function noodles(over: Partial<IdentifiedItem> = {}): IdentifiedItem {
  return {
    name_ru: 'лапша быстрого приготовления',
    name_en: 'instant noodles',
    est_grams: 90,
    confidence: 0.9,
    ...over,
  };
}

/// The cooked row every RU table carries for instant noodles.
const cookedRow: ProviderResult[] = [{ per100: per100(134), confidence: 0.95, name: 'Лапша быстрого приготовления' }];

test('вес сухой пачки против ГОТОВОЙ строки: строка приводится к базису веса', async () => {
  const resolver = new Resolver([provider(cookedRow)]);
  const r = await resolver.resolveItem(noodles({ weight_basis: 'dry' }), 'RU');

  assert.equal(r.dry_weight, true);
  assert.equal(r.dry_basis, undefined); // это ДРУГОЕ направление
  // Умножать сухой вес на плотность готового — не мнение, а неверная
  // арифметика: строка пересчитана той же таблицей выходов.
  assert.equal(r.per100.kcal, 335); // 134 × 2.5
  assert.equal(r.scaled.kcal, 302); // 90 г вместо 121 ккал
  // Исходная строка никуда не делась — она первая альтернатива.
  assert.equal(r.alternatives?.[0]?.name, 'Лапша быстрого приготовления');
  assert.equal(r.alternatives?.[0]?.per100.kcal, 134);
});

test('модель промолчала — сервер сам видит вес, который не может быть готовой порцией', async () => {
  const resolver = new Resolver([provider(cookedRow)]);
  const r = await resolver.resolveItem(noodles(), 'RU'); // 90 г, базис не назван

  // 90 г ГОТОВОЙ лапши не бывает: пачка 90 г даёт ~225 г готовой.
  assert.equal(r.dry_weight, true);
  assert.equal(r.per100.kcal, 335);
});

test('вес, который может быть готовой порцией, не трогается вовсе', async () => {
  const resolver = new Resolver([provider(cookedRow)]);
  const r = await resolver.resolveItem(noodles({ est_grams: 200 }), 'RU');

  assert.equal(r.dry_weight, undefined);
  assert.equal(r.dry_basis, undefined);
  assert.equal(r.per100.kcal, 134); // «гречневая лапша 200 г» — вес честно готовый
});

test('«as_eaten» на готовой строке — согласие, а не расхождение', async () => {
  const resolver = new Resolver([provider(cookedRow)]);
  const r = await resolver.resolveItem(noodles({ weight_basis: 'as_eaten', est_grams: 250 }), 'RU');

  assert.equal(r.dry_weight, undefined);
  assert.equal(r.dry_basis, undefined);
});

test('прежнее направление живо: СУХАЯ строка против веса, который сухим не назвали', async () => {
  const dryRow: ProviderResult[] = [{ per100: per100(410), confidence: 0.95, name: 'Лапша быстрого приготовления' }];
  const resolver = new Resolver([provider(dryRow)]);
  const r = await resolver.resolveItem(noodles({ est_grams: 250 }), 'RU');

  assert.equal(r.dry_basis, true);
  assert.equal(r.dry_weight, undefined);
  assert.equal(r.alternatives?.[0]?.name, 'лапша быстрого приготовления, готовое');
  assert.equal(r.alternatives?.[0]?.per100.kcal, 164); // 410 ÷ 2.5
});

test('сухой вес, названный явно, снимает прежний флаг с СУХОЙ строки — базисы совпали', async () => {
  const dryRow: ProviderResult[] = [{ per100: per100(410), confidence: 0.95, name: 'Лапша быстрого приготовления' }];
  const resolver = new Resolver([provider(dryRow)]);
  const r = await resolver.resolveItem(noodles({ weight_basis: 'dry' }), 'RU');

  assert.equal(r.dry_basis, undefined); // предупреждать не о чем
  assert.equal(r.dry_weight, undefined);
});

test('«готовое блюдо» — свойство СТРОКИ и не отменяет заявленный базис веса', async () => {
  // Ровно боевой случай: curated-строка «лапша быстрого приготовления» помечена
  // prepared, и этот флаг раньше объявлял вес готовым — расхождение с сухой
  // пачкой не замечалось вовсе, итог оставался втрое заниженным без единого слова.
  const preparedCookedRow: ProviderResult[] = [
    { per100: per100(134), confidence: 0.95, name: 'Лапша быстрого приготовления', prepared: true },
  ];
  const resolver = new Resolver([provider(preparedCookedRow)]);
  const r = await resolver.resolveItem(noodles({ weight_basis: 'dry' }), 'RU');

  assert.equal(r.prepared, true); // строка как была, так и осталась готовым блюдом
  assert.equal(r.dry_weight, true); // но про базис веса теперь сказано
  assert.equal(r.per100.kcal, 335); // и умножение исправлено
  assert.equal(r.alternatives?.[0]?.per100.kcal, 134); // исходная строка рядом
});

test('«готовое» от МОДЕЛИ — про еду, и сухую строку под ней надо привести к весу', async () => {
  // «bowl of oatmeal»: модель говорит «готовое блюдо», а строка — брендовые
  // СУХИЕ хлопья 340 ккал/100 г. Раньше флаг модели глушил предупреждение о
  // строке, и 240 г миски молча давали 816 ккал.
  const dryFlakes: ProviderResult[] = [
    { per100: per100(340), confidence: 0.9, name: 'Oatmeal ясно-солнышко' }, // строка НЕ curated
  ];
  const resolver = new Resolver([provider(dryFlakes)]);
  const r = await resolver.resolveItem(
    { name_ru: 'овсянка', name_en: 'oatmeal', est_grams: 240, confidence: 0.9, prepared: true },
    'US',
  );

  assert.equal(r.dry_basis, true);
  assert.equal(r.per100.kcal, 113); // 340 ÷ 3.0
  assert.equal(r.scaled.kcal, 271); // 240 г миски вместо 816
  assert.equal(r.alternatives?.[0]?.per100.kcal, 340); // исходная строка рядом
});

test('curated-строка готового блюда судится как готовая, а не как сухая', async () => {
  // Тот же флаг, но пришедший ОТ ТАБЛИЦЫ: строка сама описывает готовое блюдо,
  // и трогать её не за что.
  const curated: ProviderResult[] = [
    { per100: per100(105), confidence: 0.95, name: 'каша гречневая', prepared: true },
  ];
  const resolver = new Resolver([provider(curated)]);
  const r = await resolver.resolveItem(
    { name_ru: 'гречневая каша', name_en: 'buckwheat porridge', est_grams: 250, confidence: 0.9 },
    'RU',
  );

  assert.equal(r.dry_basis, undefined);
  assert.equal(r.dry_weight, undefined);
  assert.equal(r.per100.kcal, 105);
});
