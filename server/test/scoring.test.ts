import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  contradictsSugarFree,
  demoteContradictions,
  genericBonus,
  isSugarFreeQuery,
  normalizeName,
  rankByName,
  scoreName,
  scoreToConfidence,
} from '../src/nutrition/scoring.js';

test('normalizeName: lowercases, folds ё, strips punctuation', () => {
  assert.equal(normalizeName('Гречка, отварная!'), 'гречка отварная');
  assert.equal(normalizeName('Тёмный  шоколад'), 'темный шоколад');
});

test('scoreName: exact = 1, disjoint = 0, partial in between', () => {
  assert.equal(scoreName('рис', 'рис'), 1);
  assert.equal(scoreName('рис', 'банан'), 0);
  assert.ok(scoreName('куриная грудка', 'куриная грудка отварная') > 0.5);
  // candidate contains the whole query → substring bonus.
  assert.ok(scoreName('рис', 'рис басмати') >= 0.2);
});

test('genericBonus: generic up, brand down, unknown neutral', () => {
  assert.ok(genericBonus('Generic') > 0);
  assert.ok(genericBonus('Brand') < 0);
  assert.equal(genericBonus(undefined), 0);
});

test('rankByName: generic plain food beats a closer-typed brand', () => {
  const ranked = rankByName('творог', [
    { value: 'a', name: 'Творог Activia', foodType: 'Brand' },
    { value: 'b', name: 'Творог', foodType: 'Generic' },
  ]);
  assert.equal(ranked[0]?.value, 'b'); // generic exact match wins
  assert.ok(ranked[0]!.score > ranked[1]!.score);
});

test('rankByName: genericBonus never rescues a zero-name-overlap row (salad→milk)', () => {
  // FatSecret returns a "Generic" milk row for a salad query. The +0.1 generic
  // bonus must NOT lift its zero name score above 0 — otherwise it floors to
  // 0.4 confidence and survives the resolver's junk filter.
  const ranked = rankByName('овощной салат с пекинской капустой и помидорами', [
    { value: 'milk', name: '1% Fat Milk (Calcium Fortified)', foodType: 'Generic' },
  ]);
  assert.equal(ranked[0]?.score, 0);
  assert.equal(scoreToConfidence(ranked[0]!.score), 0); // → filtered out as junk
});

test('scoreToConfidence: real-but-terse hit floored at 0.4, but zero overlap → 0', () => {
  assert.equal(scoreToConfidence(0), 0); // nothing in common is NOT a match (milk vs salad)
  assert.equal(scoreToConfidence(0.1), 0.4); // a real, weak overlap is floored so it doesn't read as junk
  assert.equal(scoreToConfidence(1), 1);
  assert.ok(scoreToConfidence(0.7) > 0.4);
});

// ---- sugar-negation contradiction (the «энергетик без сахара» → Arctic bug) --

test('isSugarFreeQuery: RU and EN markers, Cyrillic without \\b', () => {
  assert.equal(isSugarFreeQuery('энергетический напиток без сахара'), true);
  assert.equal(isSugarFreeQuery('sugar-free energy drink'), true);
  assert.equal(isSugarFreeQuery('кола зеро'), true);
  assert.equal(isSugarFreeQuery('диетическая кола'), true);
  assert.equal(isSugarFreeQuery('энергетический напиток адреналин раш'), false);
  assert.equal(isSugarFreeQuery('сахар'), false); // sugar itself is not a negation
});

test('contradictsSugarFree: explicit sugar wins over the carb fallback', () => {
  assert.equal(contradictsSugarFree({ sugar: 11.2, carb: 11.6 }), true);
  assert.equal(contradictsSugarFree({ sugar: 0, carb: 0.4 }), false);
  // Sugar-free cookies: carbs are flour, explicit sugar is low → NOT a contradiction.
  assert.equal(contradictsSugarFree({ sugar: 0.5, carb: 60 }), false);
  // No sugar field at all: high-carb row reads as sugared for a drink-like query.
  assert.equal(contradictsSugarFree({ carb: 11.6 }), true);
  assert.equal(contradictsSugarFree({ carb: 0.3 }), false);
});

test('demoteContradictions: a close-named clean row floats up, contradictions capped below 0.5', () => {
  const sugared = { per100: { sugar: 11.2, carb: 11.6 }, confidence: 0.9, name: 'Arctic' };
  const zero = { per100: { sugar: 0, carb: 0.4 }, confidence: 0.75, name: 'Zero' };
  const out = demoteContradictions('энергетик без сахара', [sugared, zero]);
  assert.equal(out[0]!.name, 'Zero'); // composition beats name score
  assert.equal(out[1]!.name, 'Arctic');
  assert.ok(out[1]!.confidence <= 0.4); // flagged low → client opens «не то?»
  // Without a negation in the query nothing moves.
  const same = demoteContradictions('энергетик', [sugared, zero]);
  assert.equal(same[0]!.name, 'Arctic');
  assert.equal(same[0]!.confidence, 0.9);
});

test('demoteContradictions: an unrelated clean row is NOT promoted over the head', () => {
  const sugared = { per100: { sugar: 11.2, carb: 11.6 }, confidence: 0.67, name: 'Напиток энергетический Arctic' };
  // OFF floors weak name matches at exactly 0.4 — the real live value.
  const candy = { per100: { sugar: 0.4, carb: 9 }, confidence: 0.4, name: 'Конфеты без сахара с фундуком' };
  const out = demoteContradictions('энергетический напиток без сахара', [sugared, candy]);
  // 391-kcal candy must not become the primary for an energy-drink query —
  // the sugared head stays on top, honestly flagged low-confidence.
  assert.equal(out[0]!.name, 'Напиток энергетический Arctic');
  assert.ok(out[0]!.confidence <= 0.4);
  assert.equal(out[1]!.name, 'Конфеты без сахара с фундуком');
});
