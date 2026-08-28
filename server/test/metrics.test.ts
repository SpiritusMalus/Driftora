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

  assert.equal(after.requests.text, (before.requests.text ?? 0) + 1);
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
  assert.equal(after.requests.photo, (before.requests.photo ?? 0) + 1);
});

test('recordEscalation increments the escalation counter', () => {
  const before = metrics.snapshot();
  metrics.recordEscalation();
  assert.equal(metrics.snapshot().escalations, before.escalations + 1);
});

test('recordFailure counts the strain when one is given', () => {
  const before = metrics.snapshot();
  metrics.recordFailure('photo', 'llm_unavailable', 'timeout');
  metrics.recordFailure('photo', 'llm_unavailable', 'truncated');
  metrics.recordFailure('text', 'llm_unavailable', 'timeout');
  metrics.recordFailure('text', 'internal_error');
  const after = metrics.snapshot();

  assert.equal(after.failures_by_strain.timeout, (before.failures_by_strain.timeout ?? 0) + 2);
  assert.equal(after.failures_by_strain.truncated, (before.failures_by_strain.truncated ?? 0) + 1);
  assert.equal(after.failures_by_reason.llm_unavailable, (before.failures_by_reason.llm_unavailable ?? 0) + 3);
  // internal_error carries no strain — the strain table stays untouched by it.
  assert.equal(
    Object.values(after.failures_by_strain).reduce((a, b) => a + b, 0),
    Object.values(before.failures_by_strain).reduce((a, b) => a + b, 0) + 3,
  );
});

test('recordFunnel counts steps and paywall sources', () => {
  const before = metrics.snapshot();
  metrics.recordFunnel('paywall_shown', 'limit');
  metrics.recordFunnel('paywall_shown', 'menu');
  metrics.recordFunnel('paywall_shown', 'limit');
  metrics.recordFunnel('checkout_started');
  metrics.recordFunnel('payments_succeeded');
  const after = metrics.snapshot();

  assert.equal(after.funnel.paywall_shown, before.funnel.paywall_shown + 3);
  assert.equal(after.funnel.checkout_started, before.funnel.checkout_started + 1);
  assert.equal(after.funnel.payments_succeeded, before.funnel.payments_succeeded + 1);
  const src = after.funnel.paywall_sources as Record<string, number>;
  const srcBefore = before.funnel.paywall_sources as Record<string, number>;
  assert.equal(src.limit, (srcBefore.limit ?? 0) + 2);
  assert.equal(src.menu, (srcBefore.menu ?? 0) + 1);
});
