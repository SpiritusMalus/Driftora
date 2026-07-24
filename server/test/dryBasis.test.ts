import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cookedFromDry, dryStarchYield, looksDryBasis } from '../src/nutrition/dryBasis.js';
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

// ---- yield factors (raw ↔ cooked) -------------------------------------------

test('dryStarchYield: known dry starches map to their cooked/dry ratio', () => {
  assert.equal(dryStarchYield(['рис', 'rice']), 2.9);
  assert.equal(dryStarchYield(['гречка', 'buckwheat']), 3.6);
  assert.equal(dryStarchYield([undefined, undefined, 'Pasta, dry']), 2.5);
  assert.equal(dryStarchYield(['перловка']), 2.5);
  assert.equal(dryStarchYield(['овсянка']), 3.0);
});

test('dryStarchYield: unknown / variable-reconstitution starch → null (warning only)', () => {
  assert.equal(dryStarchYield(['пюре картофельное', 'instant mash']), null);
  assert.equal(dryStarchYield(['борщ', 'borscht']), null);
});

test('cookedFromDry: divides every per-100g value by the yield factor, keeps source, no mutation', () => {
  const dry = per100({ source: 'usda', kcal: 360, prot: 7, fat: 1, carb: 80, fiber: 3, minerals: { k: 100 } });
  const cooked = cookedFromDry(dry, 2.9);
  assert.equal(cooked.kcal, 124); // 360 / 2.9 = 124.1
  assert.equal(cooked.prot, 2.4); // 7 / 2.9 = 2.41
  assert.equal(cooked.fat, 0.3); // 1 / 2.9 = 0.34
  assert.equal(cooked.carb, 27.6); // 80 / 2.9 = 27.59
  assert.equal(cooked.fiber, 1); // 3 / 2.9 = 1.03
  assert.equal(cooked.minerals.k, 34.5); // 100 / 2.9 = 34.48
  assert.equal(cooked.source, 'usda'); // provenance preserved
  assert.equal(dry.kcal, 360); // input untouched
});
