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

test('вес сухой пачки против ГОТОВОЙ строки: флаг + пересчитанная альтернатива', async () => {
  const resolver = new Resolver([provider(cookedRow)]);
  const r = await resolver.resolveItem(noodles({ weight_basis: 'dry' }), 'RU');

  // Числа строки не переписываются — закон честности не меняется.
  assert.equal(r.per100.kcal, 134);
  assert.equal(r.dry_weight, true);
  assert.equal(r.dry_basis, undefined); // это ДРУГОЕ направление
  // Первая альтернатива — та же строка на базисе, в котором стоит вес.
  const top = r.alternatives?.[0];
  assert.ok(top, 'альтернатива на сухом базисе должна быть предложена');
  assert.equal(top!.name, 'лапша быстрого приготовления, сухое');
  assert.equal(top!.per100.kcal, 335); // 134 × 2.5
  // 90 г сухой пачки на сухом базисе ≈ 300 ккал вместо 121 — та самая втрое.
  assert.equal(Math.round((top!.per100.kcal * r.grams) / 100), 302);
});

test('без сигнала о базисе веса ГОТОВАЯ строка не трогается вовсе', async () => {
  const resolver = new Resolver([provider(cookedRow)]);
  const r = await resolver.resolveItem(noodles(), 'RU'); // модель промолчала

  assert.equal(r.dry_weight, undefined);
  assert.equal(r.dry_basis, undefined);
  assert.equal(r.alternatives, undefined); // ничего не выдумываем
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
