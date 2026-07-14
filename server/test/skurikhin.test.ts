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

test('normalizeRu keeps a decimal grade whole («1.8» not «1 8»)', () => {
  // The whole «1.8» must survive so it can NOT masquerade-match «молоко 1%».
  assert.equal(normalizeRu('молоко 1.8%'), 'молоко 1.8');
  assert.equal(normalizeRu('Молоко 1,8 %'), 'молоко 1.8'); // RU decimal comma → dot
  assert.equal(normalizeRu('творог 2%'), 'творог 2'); // plain integer unchanged
  assert.equal(normalizeRu('сыр 45.5% жирности'), 'сыр 45.5 жирности');
});

test('an 1.8% query no longer masquerade-matches the 1% row', async () => {
  const p = new SkurikhinProvider([
    { name: 'молоко 1%', aliases: [], per100: { kcal: 42, prot: 3.4, fat: 1, carb: 5, minerals: {} } },
    { name: 'молоко 3.2%', aliases: [], per100: { kcal: 61, prot: 2.9, fat: 3.2, carb: 4.7, minerals: {} } },
  ]);
  // «молоко 1.8%» shares only «молоко» with each row now (the «1» is gone) →
  // 0.5, below the floor → neither wrong grade is offered.
  const list = await p.searchMany!('молоко 1.8%', 'RU');
  assert.equal(list.length, 0);
  // The exact grade still resolves cleanly.
  const exact = await p.search('молоко 3.2%', 'RU');
  assert.equal(exact!.per100.kcal, 61);
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
  // Russian творог, not US cottage cheese: protein ~17 g and honestly attributed
  // to the Скурихин/RU table (was a mis-sourced 10.5 g USDA row).
  assert.ok(curd!.per100.prot >= 16);
  assert.equal(curd!.per100.kcal, 99);
  assert.equal(curd!.per100.source, 'skurikhin');
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

test('an unhonoured qualifier no longer drags in a generic row', async () => {
  const p = new SkurikhinProvider([
    { name: 'сыр российский', aliases: [], per100: { kcal: 364, prot: 23, fat: 30, carb: 0, minerals: {} } },
    { name: 'сыр лёгкий', aliases: [], per100: { kcal: 260, prot: 31, fat: 15, carb: 0, minerals: {} } },
  ]);
  // «сыр лёгкий» must NOT surface «сыр российский» (a lone «сыр» hit is 0.5,
  // below the floor); the row that honours «лёгкий» is the only candidate.
  const list = await p.searchMany!('сыр лёгкий', 'RU');
  assert.equal(list.length, 1);
  assert.equal(list[0]!.name, 'сыр лёгкий');
  // Plain «сыр» still finds both — one shared word covers a one-word query.
  const plain = await p.searchMany!('сыр', 'RU');
  assert.equal(plain.length, 2);
});

test('падеж: «борща» still finds борщ', async () => {
  const r = await provider.search('борща', 'RU');
  assert.ok(r);
  assert.equal(r!.per100.kcal, 49);
  assert.ok(r!.confidence >= 0.7);
});

test('полуслова: «гречк» (search-as-you-type) finds гречку', async () => {
  const r = await provider.search('гречк', 'RU');
  assert.ok(r);
  assert.equal(r!.per100.kcal, 92);
});

test('одна опечатка: «гретчка» finds гречку', async () => {
  const r = await provider.search('гретчка', 'RU');
  assert.ok(r);
  assert.equal(r!.per100.kcal, 92);
  assert.ok(r!.confidence < 0.9, 'a typo match must read less certain than exact');
});

test('searchMany: ranked candidates, exact first, composites behind', async () => {
  const list = await provider.searchMany!('борщ', 'RU');
  assert.ok(list.length >= 2, 'plain борщ and борщ с мясом both qualify');
  assert.equal(list[0]!.name, 'борщ');
  assert.equal(list[0]!.per100.kcal, 49);
  assert.ok(list[0]!.confidence >= 0.9);
  assert.ok(list.some((r) => r.name === 'борщ с мясом'));
  assert.ok(list[1]!.confidence < list[0]!.confidence);
});

test('stateless plain names resolve to state-explicit row names (transparency)', async () => {
  // SR rows for meat/fish are COOKED — the row name must say so, because the
  // card shows it («куриная грудка» = 165 kcal/31 prot is the ROASTED breast;
  // raw is ~120/22).
  const chicken = await provider.search('куриная грудка', 'RU');
  assert.equal(chicken!.name, 'куриная грудка запечённая');
  assert.ok(chicken!.confidence >= 0.9); // plain name stays an exact alias
  const tuna = await provider.search('тунец', 'RU');
  assert.equal(tuna!.name, 'тунец консервированный');
  const squid = await provider.search('кальмар', 'RU');
  assert.equal(squid!.name, 'кальмар жареный');
});

test('curated finished dishes carry prepared: true; products do not', async () => {
  const soup = await provider.search('суп харчо', 'RU');
  assert.ok(soup);
  assert.equal(soup!.prepared, true);
  assert.equal(soup!.per100.kcal, 75);

  // A raw-product row (USDA SR import) has no flag.
  const chicken = await provider.search('куриная грудка', 'RU');
  assert.ok(chicken);
  assert.equal(chicken!.prepared, undefined);

  // Пельмени: варят или жарят дома — the chips stay useful, deliberately unflagged.
  const pelmeni = await provider.search('пельмени', 'RU');
  assert.ok(pelmeni);
  assert.equal(pelmeni!.prepared, undefined);
});

test('resolver: prepared comes from the curated row OR the LLM signal', async () => {
  const resolver = new Resolver([new SkurikhinProvider(), new UsdaProvider('KEY')]);
  // Curated flag alone (identification said nothing).
  const soup = await resolver.resolveItem(
    item({ name_ru: 'суп харчо', name_en: 'kharcho soup', est_grams: 250 }),
    'RU',
  );
  assert.equal(soup.prepared, true);
  assert.equal(soup.matched_name, 'суп харчо'); // transparency: the row's own name travels
  // LLM signal alone (a product row sets no flag). Runs BEFORE the unflagged
  // case so the shared name-keyed lookup cache is proven per-item-independent.
  const dish = await resolver.resolveItem(item({ name_ru: 'гречка', name_en: 'buckwheat', prepared: true }), 'RU');
  assert.equal(dish.prepared, true);
  // Neither → the field is absent from the wire item entirely.
  const plain = await resolver.resolveItem(item({ name_ru: 'гречка', name_en: 'buckwheat' }), 'RU');
  assert.ok(!('prepared' in plain));
  // The user logged «гречка»; the numbers are for the BOILED row — say so.
  assert.equal(plain.matched_name, 'гречка варёная');
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
