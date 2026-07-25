import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluate, THRESHOLDS, type MetricsSnapshot } from '../eval/slo.js';

/** A snapshot of a service that is behaving, with enough traffic to judge. */
function healthy(over: Partial<MetricsSnapshot> = {}): MetricsSnapshot {
  return {
    uptime_s: 86_400,
    requests: { text: 80, photo: 20, audio: 0 },
    empty: 2,
    escalations: 4,
    sources: { skurikhin: 60, usda: 40, fatsecret: 10, ai_estimate: 8, estimate: 2 },
    latency_ms: { text: { avg: 2_100, count: 80 }, photo: { avg: 6_400, count: 20 } },
    ...over,
  };
}

const alerts = (m: MetricsSnapshot) => evaluate(m).violations.filter((v) => v.level === 'alert');
const targets = (m: MetricsSnapshot) => evaluate(m).violations.filter((v) => v.level === 'slo');

test('a healthy service produces no violations at all', () => {
  const { violations, sampled } = evaluate(healthy());
  assert.equal(sampled, true);
  assert.deepEqual(violations, []);
});

test('empty parses past the alert floor fire an alert', () => {
  // 85 % success — under the 90 % alert floor.
  const fired = alerts(healthy({ empty: 15 }));
  assert.equal(fired.length, 1);
  assert.equal(fired[0]?.sli, 'parseSuccess');
  assert.match(fired[0]?.message ?? '', /85\.0%/);
});

test('a dip between the target and the alert floor reports without alerting', () => {
  // 93 % — below the 95 % target, above the 90 % floor.
  const m = healthy({ empty: 7 });
  assert.deepEqual(alerts(m), []);
  assert.equal(targets(m)[0]?.sli, 'parseSuccess');
});

test('a provider outage masked by the model is caught by the ai_estimate share', () => {
  // Every other number still looks fine: 98 % parse success, normal latency.
  const outage = healthy({ sources: { skurikhin: 5, usda: 3, ai_estimate: 92 } });
  const fired = alerts(outage);
  assert.equal(fired.length, 1);
  assert.equal(fired[0]?.sli, 'aiEstimateShare');
  assert.match(fired[0]?.message ?? '', /provider is probably down/);
});

test('escalations past the ceiling are flagged as the cost signal', () => {
  assert.equal(alerts(healthy({ escalations: 30 }))[0]?.sli, 'escalationRate');
});

test('slow routes are flagged per route, at their own ceilings', () => {
  const slowText = alerts(healthy({ latency_ms: { text: { avg: 7_000, count: 80 } } }));
  assert.equal(slowText[0]?.sli, 'latency.text');

  // 7 s is an alert for text and perfectly normal for a photo.
  const slowPhoto = evaluate(healthy({ latency_ms: { photo: { avg: 7_000, count: 20 } } }));
  assert.deepEqual(slowPhoto.violations, []);
});

test('a small sample skips every ratio — the state right after a restart', () => {
  // 100 % empty, but only three requests since the counters reset. Alerting on
  // this would page someone on every single deploy.
  const fresh: MetricsSnapshot = {
    uptime_s: 60,
    requests: { text: 3 },
    empty: 3,
    escalations: 3,
    sources: { ai_estimate: 3 },
  };
  const { violations, sampled } = evaluate(fresh);
  assert.equal(sampled, false);
  assert.deepEqual(violations, []);
});

test('latency is still judged on a small sample — one slow route means something alone', () => {
  const fresh: MetricsSnapshot = {
    requests: { text: 3 },
    empty: 0,
    latency_ms: { text: { avg: 20_100, count: 3 } },
  };
  const { sampled, violations } = evaluate(fresh);
  assert.equal(sampled, false);
  assert.equal(violations[0]?.sli, 'latency.text');
});

test('an empty or unfamiliar snapshot degrades quietly instead of throwing', () => {
  assert.deepEqual(evaluate({}).violations, []);
  assert.deepEqual(evaluate({ requests: {}, sources: {} }).violations, []);
  // A route added later must not break the checker before its threshold exists.
  assert.deepEqual(evaluate({ latency_ms: { video: { avg: 99_000, count: 5 } } }).violations, []);
});

test('the alert level is always looser than the target it backs', () => {
  assert.ok(THRESHOLDS.parseSuccess.alert < THRESHOLDS.parseSuccess.slo);
  assert.ok(THRESHOLDS.aiEstimateShare.alert > THRESHOLDS.aiEstimateShare.slo);
  assert.ok(THRESHOLDS.escalationRate.alert > THRESHOLDS.escalationRate.slo);
  assert.ok(THRESHOLDS.latencyMs.text.alert > THRESHOLDS.latencyMs.text.slo);
  assert.ok(THRESHOLDS.latencyMs.photo.alert > THRESHOLDS.latencyMs.photo.slo);
});
