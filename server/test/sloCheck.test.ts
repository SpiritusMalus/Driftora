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

test('latency is still judged on a small sample — but as a target miss, not an alert', () => {
  // One slow route means something alone, so it stays in the run output. But
  // failing the workflow on it would mail someone every hour until the next
  // restart, since counters accumulate — the 2026-08-07 incident: one 15.1 s
  // photo parse (n=1) over the 15 s ceiling turned into a day of red runs.
  const fresh: MetricsSnapshot = {
    requests: { text: 3 },
    empty: 0,
    latency_ms: { text: { avg: 20_100, count: 3 } },
  };
  const { sampled, violations } = evaluate(fresh);
  assert.equal(sampled, false);
  assert.equal(violations[0]?.sli, 'latency.text');
  assert.equal(violations[0]?.level, 'slo');
  assert.match(violations[0]?.message ?? '', /under the 5 requests needed/);
});

test('a slow average over a real latency sample still alerts', () => {
  const slow = healthy({ latency_ms: { photo: { avg: 15_115, count: 20 } } });
  const fired = alerts(slow);
  assert.equal(fired[0]?.sli, 'latency.photo');
  assert.doesNotMatch(fired[0]?.message ?? '', /needed to alert/);
});

test('an empty or unfamiliar snapshot degrades quietly instead of throwing', () => {
  assert.deepEqual(evaluate({}).violations, []);
  assert.deepEqual(evaluate({ requests: {}, sources: {} }).violations, []);
  // A route added later must not break the checker before its threshold exists.
  assert.deepEqual(evaluate({ latency_ms: { video: { avg: 99_000, count: 5 } } }).violations, []);
});

test('a day of uptime with no parses at all is reported, not scored as perfect', () => {
  // The blind spot this check exists for: with zero requests every ratio is
  // vacuously healthy (100 % success, 0 % model-guessed, 0 % escalations) and
  // the run went green while the client could not reach the service at all.
  const silent: MetricsSnapshot = {
    uptime_s: 30 * 3600,
    requests: { text: 0, photo: 0, audio: 0 },
    empty: 0,
    escalations: 0,
    sources: {},
  };
  const { violations, totals } = evaluate(silent);
  assert.equal(totals.parseSuccess, 1); // still vacuously perfect…
  assert.equal(violations.length, 1); // …but no longer silent about it
  assert.equal(violations[0]?.sli, 'traffic');
  assert.equal(violations[0]?.level, 'slo'); // a warning: a quiet day is not an outage
});

test('a quiet stretch shorter than the silence threshold stays quiet', () => {
  // Nights exist. Only a full day of nothing is worth a line in the run.
  const overnight: MetricsSnapshot = { uptime_s: 8 * 3600, requests: { text: 0 } };
  assert.deepEqual(evaluate(overnight).violations, []);
});

test('the alert level is always looser than the target it backs', () => {
  assert.ok(THRESHOLDS.parseSuccess.alert < THRESHOLDS.parseSuccess.slo);
  assert.ok(THRESHOLDS.aiEstimateShare.alert > THRESHOLDS.aiEstimateShare.slo);
  assert.ok(THRESHOLDS.escalationRate.alert > THRESHOLDS.escalationRate.slo);
  assert.ok(THRESHOLDS.latencyMs.text.alert > THRESHOLDS.latencyMs.text.slo);
  assert.ok(THRESHOLDS.latencyMs.photo.alert > THRESHOLDS.latencyMs.photo.slo);
});
