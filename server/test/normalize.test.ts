import assert from 'node:assert/strict';
import { test } from 'node:test';

import { emptyResult, normalizeResult } from '../src/types.js';

test('maps a multi-item payload and sums totals', () => {
  const r = normalizeResult({
    items: [
      { name: 'Омлет из трёх яиц', qtyG: 165, kcal: 320, proteinG: 21, fatG: 24, carbG: 2, assumptions: '≈3 яйца' },
      { name: 'Кофе с молоком', qtyG: 200, kcal: 60, proteinG: 3, fatG: 3, carbG: 5, assumptions: '≈200 мл' },
    ],
    confidence: 'medium',
    needsClarification: false,
    clarifyQuestion: null,
  });

  assert.equal(r.items.length, 2);
  assert.equal(r.kcal, 380);
  assert.equal(r.proteinG, 24);
  assert.equal(r.fatG, 27);
  assert.equal(r.carbG, 7);
  assert.equal(r.confidence, 'medium');
  assert.equal(r.needsClarification, false);
  assert.equal(r.clarifyQuestion, null);
});

test('totals always equal the sum of items, ignoring model-provided totals', () => {
  const r = normalizeResult({
    items: [
      { name: 'Банан', qtyG: 120, kcal: 105, proteinG: 1.3, fatG: 0.4, carbG: 27, assumptions: '' },
      { name: 'Рис', qtyG: 150, kcal: 195, proteinG: 4, fatG: 0.5, carbG: 42, assumptions: '' },
    ],
    // bogus totals the model might hallucinate — must be ignored
    kcal: 9999,
    confidence: 'high',
    needsClarification: false,
    clarifyQuestion: null,
  });
  assert.equal(r.kcal, 300);
  assert.equal(r.carbG, 69);
});

test('clarification branch keeps the question and may have empty items', () => {
  const r = normalizeResult({
    items: [],
    confidence: 'low',
    needsClarification: true,
    clarifyQuestion: 'Сколько ложек сахара в кофе?',
  });
  assert.equal(r.items.length, 0);
  assert.equal(r.needsClarification, true);
  assert.equal(r.clarifyQuestion, 'Сколько ложек сахара в кофе?');
});

test('needsClarification without a question collapses to false', () => {
  const r = normalizeResult({
    items: [],
    confidence: 'low',
    needsClarification: true,
    clarifyQuestion: '',
  });
  assert.equal(r.needsClarification, false);
  assert.equal(r.clarifyQuestion, null);
});

test('unknown confidence clamps to low', () => {
  const r = normalizeResult({ items: [], confidence: 'wat', needsClarification: false, clarifyQuestion: null });
  assert.equal(r.confidence, 'low');
});

test('garbage payload normalizes to a valid empty result, never throws', () => {
  for (const junk of [null, undefined, 42, 'nope', { items: 'x' }, { items: [null, {}, { name: '' }] }]) {
    const r = normalizeResult(junk);
    assert.equal(r.items.length, 0);
    assert.equal(r.kcal, 0);
    assert.equal(r.confidence, 'low');
    assert.equal(r.needsClarification, false);
  }
});

test('coerces string numbers, clamps negatives, rounds, drops nameless items', () => {
  const r = normalizeResult({
    items: [
      { name: 'Творог', qtyG: '180', kcal: '198.6', proteinG: -5, fatG: 2.04, carbG: 5.95, assumptions: '  жирность 5%  ' },
      { name: '   ', qtyG: 10, kcal: 100, proteinG: 1, fatG: 1, carbG: 1, assumptions: '' },
    ],
    confidence: 'high',
    needsClarification: false,
    clarifyQuestion: null,
  });
  assert.equal(r.items.length, 1);
  const it = r.items[0]!;
  assert.equal(it.qtyG, 180);
  assert.equal(it.kcal, 199);
  assert.equal(it.proteinG, 0);
  assert.equal(it.fatG, 2);
  assert.equal(it.carbG, 6);
  assert.equal(it.assumptions, 'жирность 5%');
});

test('emptyResult is a valid unrecognized result', () => {
  const r = emptyResult();
  assert.deepEqual(r.items, []);
  assert.equal(r.needsClarification, false);
  assert.equal(r.clarifyQuestion, null);
});
