import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cookedFromDry,
  dryFromCooked,
  dryStarchYield,
  looksDryBasis,
  rowBasis,
  weighedDry,
} from '../src/nutrition/dryBasis.js';
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

// ---- basis is a property of the PAIR, not of one side ------------------------

test('rowBasis: a starch row states dry, cooked, or nothing at all', () => {
  assert.equal(rowBasis(['лапша', 'noodles'], per100({ kcal: 410 })), 'dry');
  assert.equal(rowBasis(['лапша быстрого приготовления', 'instant noodles'], per100({ kcal: 134 })), 'cooked');
  // The gap between the two thresholds is deliberately unreadable: a row there
  // states neither basis, and guessing is what breaks the honest half.
  assert.equal(rowBasis(['рис', 'rice'], per100({ kcal: 220 })), 'unknown');
  // Not a starch → the two states don't differ threefold, so we say nothing.
  assert.equal(rowBasis(['масло', 'butter'], per100({ kcal: 748 })), 'unknown');
  assert.equal(rowBasis(['грудка', 'chicken breast'], per100({ kcal: 165 })), 'unknown');
});

test('dryFromCooked mirrors cookedFromDry — the same water, read the other way', () => {
  const cooked = per100({ source: 'skurikhin', kcal: 134, prot: 4, fat: 6, carb: 16, fiber: 1, minerals: { k: 40 } });
  const dry = dryFromCooked(cooked, 2.5);
  assert.equal(dry.kcal, 335); // 134 × 2.5
  assert.equal(dry.prot, 10);
  assert.equal(dry.fat, 15);
  assert.equal(dry.carb, 40);
  assert.equal(dry.fiber, 2.5);
  assert.equal(dry.minerals.k, 100);
  assert.equal(dry.source, 'skurikhin'); // provenance preserved
  assert.equal(cooked.kcal, 134); // input untouched
  // Round-trip: dry → cooked → dry lands back where it started.
  assert.equal(cookedFromDry(dry, 2.5).kcal, 134);
});

test('weighedDry: вес, который не может быть готовой порцией этого крахмала', () => {
  // Пачка лапши 90 г → ~225 г готовой: вес сухой.
  assert.equal(weighedDry(['лапша быстрого приготовления'], 90), true);
  assert.equal(weighedDry(['гречка', 'buckwheat'], 60), true); // 60 × 3.6 = 216 г
  // Готовые порции — не трогаем: и большую, и скромную.
  assert.equal(weighedDry(['гречневая лапша'], 200), false);
  assert.equal(weighedDry(['рис', 'rice'], 150), false);
  // Слишком мало, чтобы дать порцию даже сухим (щепотка в супе) — молчим.
  assert.equal(weighedDry(['рис', 'rice'], 20), false);
  // Не крахмал или неизвестный выход — сказать нечего.
  assert.equal(weighedDry(['куриная грудка', 'chicken breast'], 90), false);
  assert.equal(weighedDry(['пюре картофельное', 'instant mash'], 90), false);
});
