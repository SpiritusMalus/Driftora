import assert from 'node:assert/strict';
import { test } from 'node:test';

import { looksDryBasis } from '../src/nutrition/dryBasis.js';
import type { Per100 } from '../src/types.js';

function per100(over: Partial<Per100> = {}): Per100 {
  return { source: 'openfoodfacts', kcal: 410, prot: 8, fat: 20, carb: 49, minerals: {}, ...over };
}

test('dry instant noodles (dense label) → flagged', () => {
  assert.equal(looksDryBasis(['лапша быстрого приготовления готовая', 'instant noodles'], per100()), true);
});

test('dry pasta / rice by their DB row name → flagged', () => {
  assert.equal(looksDryBasis(['паста', undefined, 'Pasta, dry'], per100({ kcal: 360 })), true);
  assert.equal(looksDryBasis(['рис', 'rice'], per100({ source: 'usda', kcal: 360 })), true);
});

test('a cooked starch (low density) is NOT flagged — that state is already right', () => {
  assert.equal(looksDryBasis(['рис', 'rice'], per100({ source: 'usda', kcal: 130 })), false);
  assert.equal(looksDryBasis(['макароны варёные', 'boiled pasta'], per100({ kcal: 150 })), false);
});

test('a dense NON-starch (butter, nuts) is NOT flagged — no dry-cooked ambiguity', () => {
  assert.equal(looksDryBasis(['масло сливочное', 'butter'], per100({ kcal: 748 })), false);
  assert.equal(looksDryBasis(['грецкий орех', 'walnut'], per100({ kcal: 654 })), false);
});

test('a coarse estimate is never a "label" → not flagged', () => {
  assert.equal(looksDryBasis(['лапша', 'noodles'], per100({ source: 'estimate', kcal: 410 })), false);
});
