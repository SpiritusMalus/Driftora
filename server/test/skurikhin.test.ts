import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeRu, SkurikhinProvider } from '../src/nutrition/skurikhin.js';
import { Resolver } from '../src/nutrition/resolver.js';
import { UsdaProvider } from '../src/nutrition/usda.js';
import type { IdentifiedItem } from '../src/types.js';

const provider = new SkurikhinProvider();

function item(over: Partial<IdentifiedItem> = {}): IdentifiedItem {
  return { name_ru: 'куриная грудка', name_en: 'chicken breast', est_grams: 150, confidence: 0.9, ...over };
}

test('normalizeRu lowercases, ё→е, strips punctuation', () => {
  assert.equal(normalizeRu('Гречка (варёная)!'), 'гречка вареная');
});

test('exact name match returns skurikhin per100 with minerals', async () => {
  const r = await provider.search('куриная грудка', 'RU');
  assert.ok(r);
  assert.equal(r!.per100.source, 'skurikhin');
  assert.equal(r!.per100.prot, 23.6);
  assert.equal(r!.per100.minerals.k, 292);
  assert.ok(r!.confidence >= 0.9);
});

test('alias match: "греч" → гречка', async () => {
  const r = await provider.search('греч', 'RU');
  assert.ok(r);
  assert.equal(r!.per100.kcal, 110);
});

test('word-overlap fallback: "куриная грудка отварная" still matches', async () => {
  const r = await provider.search('куриная грудка отварная', 'RU');
  assert.ok(r);
  assert.equal(r!.per100.source, 'skurikhin');
  assert.ok(r!.confidence < 0.95, 'fuzzy match has lower confidence than exact');
});

test('miss returns null (chain moves on)', async () => {
  const r = await provider.search('абракадабра несъедобная', 'RU');
  assert.equal(r, null);
});

test('RU routing: resolver uses Skurikhin, never USDA', async () => {
  // USDA would throw if called (no fetch mock) — proves it is skipped for RU.
  const resolver = new Resolver([new SkurikhinProvider(), new UsdaProvider('KEY')]);
  const r = await resolver.resolveItem(item({ name_ru: 'гречка', est_grams: 200 }), 'RU');
  assert.equal(r.per100.source, 'skurikhin');
  // scaled = 110 * 2
  assert.equal(r.scaled.kcal, 220);
  assert.equal(r.grams_source, 'estimated');
  assert.equal(r.approximate, true);
});
