import assert from 'node:assert/strict';
import { test } from 'node:test';

import { genericBonus, normalizeName, rankByName, scoreName, scoreToConfidence } from '../src/nutrition/scoring.js';

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

test('scoreToConfidence: floored so a real hit is never junk-low', () => {
  assert.equal(scoreToConfidence(0), 0.4);
  assert.equal(scoreToConfidence(1), 1);
  assert.ok(scoreToConfidence(0.7) > 0.4);
});
