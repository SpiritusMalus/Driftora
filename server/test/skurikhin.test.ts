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

test('exact name match returns per100 with minerals (USDA-sourced, attributed)', async () => {
  const r = await provider.search('куриная грудка', 'RU');
  assert.ok(r);
  assert.equal(r!.per100.source, 'usda'); // data from USDA SR Legacy, honestly attributed
  assert.equal(r!.per100.prot, 31);
  assert.equal(r!.per100.minerals.k, 256);
  assert.ok(r!.confidence >= 0.9);
});

test('alias match: "греча" → гречка варёная', async () => {
  const r = await provider.search('греча', 'RU');
  assert.ok(r);
  assert.equal(r!.per100.kcal, 92);
});

test('sample new entries resolve with sane values', async () => {
  const banana = await provider.search('банан', 'RU');
  assert.equal(banana!.per100.kcal, 89);
  assert.equal(banana!.per100.minerals.k, 358);

  const curd = await provider.search('творог', 'RU'); // alias of "творог 2%"
  assert.ok(curd!.per100.prot >= 10);
  assert.equal(curd!.per100.source, 'usda');
});

test('word-overlap fallback: "куриная грудка отварная" still matches', async () => {
  const r = await provider.search('куриная грудка отварная', 'RU');
  assert.ok(r);
  assert.equal(r!.per100.source, 'usda');
  assert.ok(r!.confidence < 0.95, 'fuzzy match has lower confidence than exact');
});

test('curated common food: "пончик" resolves (was a DB miss → estimate)', async () => {
  const r = await provider.search('пончик', 'RU');
  assert.ok(r, 'пончик should now be found in the curated RU rows');
  assert.equal(r!.per100.source, 'skurikhin'); // curated RU table, honestly attributed
  assert.equal(r!.per100.kcal, 296);
  // alias/plural still matches the same entry.
  const plural = await provider.search('пончики', 'RU');
  assert.equal(plural!.per100.kcal, 296);
});

test('miss returns null (chain moves on)', async () => {
  const r = await provider.search('абракадабра несъедобная', 'RU');
  assert.equal(r, null);
});

test('RU routing: resolver uses Skurikhin, never USDA', async () => {
  // USDA would throw if called (no fetch mock) — proves it is skipped for RU.
  const resolver = new Resolver([new SkurikhinProvider(), new UsdaProvider('KEY')]);
  const r = await resolver.resolveItem(item({ name_ru: 'гречка', est_grams: 200 }), 'RU');
  assert.equal(r.per100.source, 'usda'); // from the RU table (SR Legacy data), not the live USDA provider
  // scaled = 92 * 2
  assert.equal(r.scaled.kcal, 184);
  assert.equal(r.grams_source, 'estimated');
  assert.equal(r.approximate, true);
});
