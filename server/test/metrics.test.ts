import assert from 'node:assert/strict';
import { test } from 'node:test';

import { metrics } from '../src/metrics.js';
import { assembleMealDraft, scaleToGrams, type NutritionItem, type Per100 } from '../src/types.js';

const usda: Per100 = { source: 'usda', kcal: 165, prot: 31, fat: 3.6, carb: 0, minerals: {} };
const est: Per100 = { source: 'estimate', kcal: 150, prot: 5, fat: 5, carb: 20, minerals: {} };

function draftWith(per100: Per100, confidence: number) {
  const item: NutritionItem = {
    name_ru: 'x', name_en: 'x', grams: 100, grams_source: 'estimated',
    confidence, per100, scaled: scaleToGrams(per100, 100), approximate: true,
  };
  return assembleMealDraft('US', [item]);
}

test('recordParse increments requests, region, source, and latency', () => {
  const before = metrics.snapshot();
  metrics.recordParse('text', 'US', draftWith(usda, 0.9), 20);
  const after = metrics.snapshot();

  assert.equal(after.requests.text, before.requests.text + 1);
  assert.equal(after.by_region.US, before.by_region.US + 1);
  assert.equal(after.sources.usda, before.sources.usda + 1);
  assert.equal(after.latency_ms.text!.count, before.latency_ms.text!.count + 1);
});

test('recordParse counts low_confidence and estimate-source draws', () => {
  const before = metrics.snapshot();
  metrics.recordParse('photo', 'RU', draftWith(est, 0.2), 30);
  const after = metrics.snapshot();

  assert.equal(after.low_confidence, before.low_confidence + 1);
  assert.equal(after.sources.estimate, before.sources.estimate + 1);
  assert.equal(after.requests.photo, before.requests.photo + 1);
});

test('recordEscalation increments the escalation counter', () => {
  const before = metrics.snapshot();
  metrics.recordEscalation();
  assert.equal(metrics.snapshot().escalations, before.escalations + 1);
});
