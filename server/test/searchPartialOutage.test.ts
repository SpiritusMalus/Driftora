import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProviderUnavailable, type NutritionProvider, type ProviderResult } from '../src/nutrition/provider.js';
import { Resolver } from '../src/nutrition/resolver.js';
import type { Per100 } from '../src/types.js';

/**
 * ЧАСТИЧНЫЙ ОТКАЗ — НЕ ОТКАЗ. `sources_down` существует ради одного
 * предложения на экране: «база не ответила» вместо «такой еды нет». Пока
 * список не пуст, второе предложение не нужно, а первое — ложь про базы,
 * которые ответили.
 */

const row: Per100 = { source: 'skurikhin', kcal: 49, prot: 1, fat: 2, carb: 6, minerals: {} };

function answering(results: ProviderResult[]): NutritionProvider {
  return {
    name: 'жив',
    regions: ['RU'],
    async search() {
      return results[0] ?? null;
    },
    async searchMany() {
      return results;
    },
  };
}

const dead: NutritionProvider = {
  name: 'лёг',
  regions: ['RU'],
  async search() {
    throw new ProviderUnavailable('лёг', 503);
  },
  async searchMany() {
    throw new ProviderUnavailable('лёг', 503);
  },
};

test('один источник лёг, другой ответил → список есть, флага нет', async () => {
  const resolver = new Resolver([dead, answering([{ per100: row, confidence: 0.9, name: 'Борщ' }])]);
  const out = await resolver.search('борщ', 'RU');

  assert.equal(out.candidates.length, 1);
  assert.equal(out.sourcesDown, false); // база ответила — сказать «не ответила» нечестно
});

test('ответить было некому и список пуст → флаг поднят: пустота может быть ложной', async () => {
  const resolver = new Resolver([dead, answering([])]);
  const out = await resolver.search('мивина', 'RU');

  assert.deepEqual(out.candidates, []);
  assert.equal(out.sourcesDown, true);
});

test('пусто при всех живых источниках — честное «такой еды нет», без флага', async () => {
  const resolver = new Resolver([answering([])]);
  const out = await resolver.search('несуществующая еда', 'RU');

  assert.deepEqual(out.candidates, []);
  assert.equal(out.sourcesDown, false);
});

// ---- отказ должен называть причину ------------------------------------------

test('ProviderUnavailable называет причину словом, пригодным для счётчика', () => {
  assert.equal(new ProviderUnavailable('usda', 429).reason(), 'throttled');
  assert.equal(new ProviderUnavailable('usda', 503).reason(), 'server_error');
  assert.equal(new ProviderUnavailable('usda', 403).reason(), 'rejected');
  assert.equal(new ProviderUnavailable('usda', 404).reason(), 'http_404');
  // AbortSignal.timeout отвергает TimeoutError-ом — «мы не дождались», а не «отказ».
  assert.equal(new ProviderUnavailable('usda', new DOMException('t', 'TimeoutError')).reason(), 'timeout');
  assert.equal(new ProviderUnavailable('usda', new TypeError('fetch failed')).reason(), 'network');
  assert.equal(new ProviderUnavailable('usda').reason(), 'unknown');
});

test('резолвер докладывает наверх ИМЯ источника и причину, а не голый факт', async () => {
  const seen: string[] = [];
  const resolver = new Resolver([dead], undefined, (source, reason) => seen.push(`${source}.${reason}`));
  await resolver.search('борщ', 'RU');

  assert.deepEqual(seen, ['лёг.server_error']);
});
